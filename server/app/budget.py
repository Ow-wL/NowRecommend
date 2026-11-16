"""Daily limits on what costs money, counted in the database (2026-11-17).

The per-minute limit (ratelimit.py) lives in process memory: a restart forgets it and nothing adds its minutes up, so
anyone could keep the paid model busy all day. These counters survive restarts and are shared by every instance:

- `ai:total`: model calls of the whole service per day (AI_DAILY_LIMIT). Past it the model is not called at all and
  every answer falls back the way it already does when the model fails (catalog picks, rule parsing).
- `ai:u:<user id>` / `ai:g:<hash>`: requests of one account or one guest address per day. Guests get less.
- `signup:<hash>`: accounts created from one address per day, so member allowances cannot be minted in bulk.

A guest is told apart by address, kept only as a keyed hash and deleted after a week. One UPSERT both checks and counts,
so two requests cannot both take the last one.

A caller is charged where the money is spent: `Gate` wraps the models of one request and counts the caller's day at the
first call that really reaches a model, so an answer from the cache, the rules or pinned items costs them nothing, and
the query embedding (a paid call too) is skipped once nothing is left.
"""
import hashlib
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from fastapi import Depends, Request
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import get_session, get_sessionmaker
from .models import UsageDaily
from .ratelimit import client_address

log = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))  # the day turns over at Korean midnight, when its users' day does
TOTAL = "ai:total"
KEEP_DAYS = 7

# Counted only while below the limit; no row comes back once it is reached. PostgreSQL and SQLite both read this.
_TAKE = text(
    "INSERT INTO usage_daily (day, bucket, count) VALUES (:day, :bucket, 1) "
    "ON CONFLICT (day, bucket) DO UPDATE SET count = usage_daily.count + 1 WHERE usage_daily.count < :limit "
    "RETURNING count"
)


class BudgetSpent(RuntimeError):
    """The service's model calls for today are used up. Callers treat it like any model failure."""


class AllowanceSpent(RuntimeError):
    """This caller's requests for today are used up. Callers treat it like any model failure."""


def today() -> date:
    return datetime.now(KST).date()


def take(session: Session, bucket: str, limit: int, day: date | None = None) -> int | None:
    """Counts one use and returns the new count, or None when the day's limit is reached. A limit of 0 or less is "no
    limit" and counts nothing."""
    if limit <= 0:
        return 0
    count = session.execute(_TAKE, {"day": day or today(), "bucket": bucket, "limit": limit}).scalar()
    session.commit()
    return count


def used(session: Session, bucket: str, day: date | None = None) -> int:
    return session.scalar(select(UsageDaily.count).where(UsageDaily.day == (day or today()), UsageDaily.bucket == bucket)) or 0


def forget_old(session: Session, day: date | None = None) -> None:
    session.execute(delete(UsageDaily).where(UsageDaily.day < (day or today()) - timedelta(days=KEEP_DAYS)))
    session.commit()


def take_total() -> bool:
    """One model call against the service's day (used by llm.provider.BudgetedModel, outside any request).
    A database that cannot answer counts as "spent": an unknown bill is not run up."""
    limit = get_settings().ai_daily_limit
    if limit <= 0:
        return True
    try:
        with get_sessionmaker()() as session:
            count = take(session, TOTAL, limit)
            if count == 1:  # the first call of a day also clears the days nobody needs any more
                forget_old(session)
            return count is not None
    except Exception:  # noqa: BLE001 - whatever the database said, the answer here is "do not call the model"
        log.exception("AI budget could not be read; the model is not called")
        return False


def guest_key(address: str, secret: str | None) -> str:
    """The address as a keyed hash: enough to count one visitor's day, not enough to read the address back."""
    return hashlib.sha256(f"{secret or 'nowrecommend'}|{address}".encode()).hexdigest()[:24]


@dataclass
class Allowance:
    """One caller's requests for today. `limit` 0 means no limit."""
    session: Session
    bucket: str
    limit: int
    member: bool

    def left(self) -> bool:
        return self.limit <= 0 or used(self.session, self.bucket) < self.limit

    def take(self) -> bool:
        return take(self.session, self.bucket, self.limit) is not None


class Gate:
    """One request's way to the paid models. The caller's day is charged once, at the first generation call that is
    really made; the embedding only asks whether anything is left."""

    def __init__(self, allowance: Allowance | None):
        self.allowance, self._admitted, self._open, self.service_spent = allowance, None, None, False

    def open(self) -> bool:
        if self._admitted is not None:
            return self._admitted
        if self._open is None:
            self._open = self.allowance is None or self.allowance.left()
        return self._open

    def admit(self) -> bool:
        if self._admitted is None:
            self._admitted = self.allowance is None or self.allowance.take()
        return self._admitted

    def model(self, inner):
        return GatedModel(inner, self) if inner is not None else None

    def embedder(self, embed: Callable[[str], list[float]] | None):
        if embed is None:
            return None

        def gated(words: str) -> list[float]:
            if not self.open():
                raise AllowanceSpent("no daily allowance left for the query embedding")
            try:
                return embed(words)
            except BudgetSpent:
                self.service_spent = True
                raise

        return gated

    def limit(self) -> str | None:
        """Why the model was not asked, for the answer's meta: the whole service's day, or this caller's."""
        if self.service_spent:
            return "service"
        if self._admitted is False or self._open is False:
            return "member" if self.allowance and self.allowance.member else "guest"
        return None


class GatedModel:
    def __init__(self, inner, gate: Gate):
        self.inner, self.model, self.gate = inner, inner.model, gate

    def generate_json(self, system: str, payload: dict, schema: dict) -> dict:
        if not self.gate.admit():
            raise AllowanceSpent("daily allowance spent")
        try:
            return self.inner.generate_json(system, payload, schema)
        except BudgetSpent:
            self.gate.service_spent = True
            raise


class BudgetedEmbedder:
    """The query embedding is a paid call as well: it is counted against the service's day like a generation."""

    def __init__(self, inner, take: Callable[[], bool]):
        self.inner, self.take = inner, take

    def embed(self, texts):
        if not self.take():
            raise BudgetSpent("daily AI budget spent")
        return self.inner.embed(texts)


def allowance_for(request: Request, user_id: uuid.UUID | None, session: Session, settings: Settings) -> Allowance:
    if user_id is not None:
        return Allowance(session, f"ai:u:{user_id}", settings.ai_daily_per_member, True)
    address = client_address(request, settings.trust_proxy)
    return Allowance(session, f"ai:g:{guest_key(address, settings.auth_secret)}", settings.ai_daily_per_guest, False)


def signup_day(request: Request, session: Session = Depends(get_session), settings: Settings = Depends(get_settings)) -> Allowance:
    """This address's sign-ups for today. The route asks `left()` first and `take()`s only for an account it created, so a
    mistyped form or an address already registered uses nothing up."""
    address = client_address(request, settings.trust_proxy)
    return Allowance(session, f"signup:{guest_key(address, settings.auth_secret)}", settings.signup_daily_per_address, False)

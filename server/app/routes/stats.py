"""The browser's side of the daily counts, and the admin dashboard that reads them (stats.py, 2026-11-23)."""
import statistics
from collections import Counter
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..budget import KST, TOTAL, Allowance, guest_key, used
from ..config import Settings, get_settings
from ..db import get_session
from ..models import AccessLog, Feedback, Item, RecommendationLog, Report, StatsDaily, User
from ..ratelimit import client_address
from ..retention import ACCESS_DAYS
from ..stats import CLIENT_EVENTS, EVENTS, count, today
from .reports import require_admin

router = APIRouter()
ClientEvent = Literal["visit", "pair", "type:food", "type:music"]
assert set(ClientEvent.__args__) == set(CLIENT_EVENTS)


class StatsEvent(BaseModel):
    event: ClientEvent


@router.post("/api/stats", status_code=204)
def client_event(request: StatsEvent, http: Request, session: Session = Depends(get_session), settings: Settings = Depends(get_settings)):
    """Counts one thing a browser did. Past a day's handful from one place it is quietly not counted: the numbers are
    for reading trends, and one place cannot pump them up."""
    place = Allowance(session, f"stats:{guest_key(client_address(http, settings.trust_proxy), settings.auth_secret)}", settings.stats_daily_per_address, False)
    if place.take():
        count(session, request.event, address=client_address(http, settings.trust_proxy))
    return Response(status_code=204)


@router.get("/api/admin/stats")
def dashboard(days: int = 30, _: User = Depends(require_admin), session: Session = Depends(get_session)):
    """The last `days` days (today included, oldest first), every event on every day (0 where nothing happened), and a
    few totals that are not per day."""
    if not 1 <= days <= 400:
        raise HTTPException(422, "기간은 1일에서 400일 사이로 골라주세요.")
    end = today()
    start = end - timedelta(days=days - 1)
    rows = session.execute(select(StatsDaily.day, StatsDaily.name, StatsDaily.count).where(StatsDaily.day >= start, StatsDaily.day <= end)).all()
    by_day: dict[str, dict[str, int]] = {(start + timedelta(days=n)).isoformat(): {e: 0 for e in EVENTS} for n in range(days)}
    for day, name, n in rows:
        if name in EVENTS and day.isoformat() in by_day:
            by_day[day.isoformat()][name] = n
    accounts = session.scalar(select(func.count()).select_from(User)) or 0
    confirmed = session.scalar(select(func.count()).select_from(User).where(User.email_verified_at.is_not(None))) or 0
    return {
        "days": [{"day": day, "counts": counts} for day, counts in by_day.items()],
        "totals": {"accounts": accounts, "confirmedAccounts": confirmed,
                   "feedback": session.scalar(select(func.count()).select_from(Feedback)) or 0,
                   "openReports": session.scalar(select(func.count()).select_from(Report).where(Report.status == "open")) or 0},
    }


def _issues(text: str | None) -> Counter:
    """"extra=4,store_missing=3" (ai_engine's summary) as counts."""
    out: Counter = Counter()
    for part in (text or "").split(","):
        name, _, n = part.partition("=")
        if name and n.isdigit():
            out[name] += int(n)
    return out


@router.get("/api/admin/insights")
def insights(response: Response, days: int = 7, _: User = Depends(require_admin), session: Session = Depends(get_session), settings: Settings = Depends(get_settings)):
    """What the request log, the accounts and the access list say about the last `days` days (2026-11-24): how the
    recommendations went (model or fallback, speed, store misses), what was asked and recommended most, when people came,
    and who is busiest. Nothing here is new data: it reads what is already kept."""
    if not 1 <= days <= 30:
        raise HTTPException(422, "기간은 1일에서 30일 사이로 골라주세요.")
    response.headers["Cache-Control"] = "no-store"  # addresses are in it
    now = datetime.now(KST)
    since = now - timedelta(days=days)
    logs = session.execute(select(RecommendationLog.category, RecommendationLog.params, RecommendationLog.latency_ms,
                                  RecommendationLog.result_ids, RecommendationLog.conditions, RecommendationLog.created_at, RecommendationLog.error)
                           .where(RecommendationLog.created_at >= since)).all()
    per: dict[str, dict] = {}
    hours = [0] * 24
    for category, params, latency, results, conditions, at, error in logs:
        c = per.setdefault(category, {"requests": 0, "ai": 0, "fallback": 0, "errors": 0, "latency": [], "issues": Counter(),
                                      "items": Counter(), "tags": Counter(), "excluded": Counter()})
        c["requests"] += 1
        c["ai" if (params or {}).get("engine") == "ai" else "fallback"] += 1
        c["errors"] += bool(error)
        if latency is not None:
            c["latency"].append(latency)
        c["issues"].update(_issues((params or {}).get("issues")))
        c["items"].update(results or [])
        c["tags"].update((conditions or {}).get("tags") or [])
        c["excluded"].update((conditions or {}).get("excluded") or [])
        hours[at.astimezone(KST).hour] += 1
    top_ids = {i for c in per.values() for i, _ in c["items"].most_common(10)}
    names = {r.id: (r.name, r.artist or "") for r in session.execute(select(Item.id, Item.name, Item.artist).where(Item.id.in_(top_ids)))} if top_ids else {}

    def pct(values: list[int], q: float) -> int | None:
        return round(statistics.quantiles(values, n=100)[int(q) - 1]) if len(values) >= 2 else (values[0] if values else None)

    recommendations = {category: {
        "requests": c["requests"], "ai": c["ai"], "fallback": c["fallback"], "errors": c["errors"],
        "latencyP50": pct(c["latency"], 50), "latencyP95": pct(c["latency"], 95),
        "issues": dict(c["issues"].most_common()),
        "topItems": [{"id": i, "name": names.get(i, (i, ""))[0], "artist": names.get(i, ("", ""))[1], "count": n} for i, n in c["items"].most_common(10)],
        "topTags": [{"tag": t, "count": n} for t, n in c["tags"].most_common(10)],
        "topExcluded": [{"tag": t, "count": n} for t, n in c["excluded"].most_common(8)],
    } for category, c in per.items()}

    week = now - timedelta(days=7)
    users = select(func.count()).select_from(User)
    accounts = {
        "total": session.scalar(users) or 0,
        "confirmed": session.scalar(users.where(User.email_verified_at.is_not(None))) or 0,
        "admins": session.scalar(users.where(User.is_admin)) or 0,
        "newInPeriod": session.scalar(users.where(User.created_at >= since)) or 0,
        "activeWeek": session.scalar(users.where(User.last_login_at >= week)) or 0,
        "withSavedData": session.scalar(users.where(User.store.is_not(None))) or 0,
    }
    by_address = session.execute(select(AccessLog.address, func.count(), func.max(AccessLog.at)).where(AccessLog.at >= since)
                                 .group_by(AccessLog.address).order_by(func.count().desc()).limit(10)).all()
    start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    access = {
        "addressesToday": session.scalar(select(func.count(func.distinct(AccessLog.address))).where(AccessLog.at >= start_of_today)) or 0,
        "addressesInPeriod": session.scalar(select(func.count(func.distinct(AccessLog.address))).where(AccessLog.at >= since)) or 0,
        "busiest": [{"address": a, "count": n, "last": last.isoformat()} for a, n, last in by_address],
    }
    feedback_kinds = dict(session.execute(select(Feedback.kind, func.count()).group_by(Feedback.kind)).all())
    report_status = dict(session.execute(select(Report.status, func.count()).group_by(Report.status)).all())
    return {"days": days, "recommendations": recommendations, "hours": hours, "accounts": accounts, "access": access,
            "ai": {"usedToday": used(session, TOTAL), "dailyLimit": settings.ai_daily_limit},
            "feedbackKinds": feedback_kinds, "reportStatus": report_status}


@router.get("/api/admin/access")
def access_list(response: Response, before: int | None = None, limit: int = 50, _: User = Depends(require_admin), session: Session = Depends(get_session)):
    """The latest entries of the access list (30 days), newest first; `before` (an entry id) pages back."""
    if not 1 <= limit <= 200:
        raise HTTPException(422, "한 번에 1~200개까지 볼 수 있어요.")
    response.headers["Cache-Control"] = "no-store"
    query = select(AccessLog).where(AccessLog.at >= datetime.now(KST) - timedelta(days=ACCESS_DAYS)).order_by(AccessLog.id.desc()).limit(limit + 1)
    if before is not None:
        query = query.where(AccessLog.id < before)
    rows = session.scalars(query).all()
    return {"entries": [{"id": r.id, "at": r.at.isoformat(), "address": r.address, "event": r.event} for r in rows[:limit]],
            "more": len(rows) > limit}

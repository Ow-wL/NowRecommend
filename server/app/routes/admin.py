"""The admin console (2026-11-26): overview, members, recommendations and AI, system state, content and the action record.

Every route needs an admin account (require_admin reads is_admin from the database on each request; admin rights are
given only by app.cli.admin). Everything an admin changes, and every look at one member's details or one address's
history, is written to admin_audit in the same transaction as the change (kept two years, retention.py).

What is shown follows the privacy policy: member lists mask the address (the full one only in a member's details), saved
data is shown as counts only (never its contents, which can hold health-related words), recommendation logs carry no
request text and no account or address, and the access list stays the 30-day one. Searches go in a POST body, so what was
searched for is not written to request logs as part of an address.
"""
import os
import re
import statistics
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import and_, any_, func, literal, or_, select, update
from sqlalchemy.orm import Session

from ..budget import KST, TOTAL, used
from ..config import Settings, get_settings
from ..db import check_database, get_session
from ..mail import Mailer, failure as mail_failure, get_mailer, suspend_mail
from ..models import AccessLog, AdminAudit, Feedback, Item, RecommendationLog, Report, StatsDaily, User
from ..retention import ACCESS_DAYS, AUDIT_DAYS, FEEDBACK_DAYS, STATS_DAYS
from ..stats import EVENTS, today
from .auth import _iso
from .reports import require_admin

router = APIRouter()
Admin = Annotated[User, Depends(require_admin)]
Reason = Annotated[str, StringConstraints(min_length=2, max_length=300, strip_whitespace=True)]
Note = Annotated[str, StringConstraints(max_length=300, strip_whitespace=True)]
# Counted in stats_daily from this day on (stats.py); the console shows "no data" before it, not zeros.
TRACKED_SINCE = {"ai": "2026-11-26", "client_error": "2026-11-26"}


def audit(session: Session, actor: User, action: str, target_type: str, target_id: str, reason: str = "", **detail) -> None:
    """One line of the action record, added to the caller's transaction (it commits with the change or not at all)."""
    session.add(AdminAudit(actor_id=actor.id, actor_email=actor.email, action=action, target_type=target_type,
                           target_id=target_id, reason=reason, detail=detail))


def _like(text: str) -> str:
    return "%" + re.sub(r"([\\%_])", r"\\\1", text) + "%"


def mask_email(email: str) -> str:
    """lee.joo@example.com → le*****@example.com: enough to tell rows apart, not to read the address off a screen."""
    local, _, domain = email.partition("@")
    return f"{local[:2]}{'*' * max(1, len(local) - 2)}@{domain}"


def mask_name(name: str) -> str:
    return name[:1] + "*" * max(1, len(name) - 1) if name else ""


def _aware(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


# ---- overview ----

@router.get("/api/admin/overview")
def overview(admin: Admin, days: int = 30, session: Session = Depends(get_session), settings: Settings = Depends(get_settings)):
    """This period against the one before (same length), day by day, and what waits for the admin."""
    if days not in (7, 30, 90):
        raise HTTPException(422, "기간은 7일, 30일, 90일 중에서 골라주세요.")
    end = today()
    start = end - timedelta(days=2 * days - 1)
    rows = session.execute(select(StatsDaily.day, StatsDaily.name, StatsDaily.count).where(StatsDaily.day >= start, StatsDaily.day <= end)).all()
    series: dict[str, dict[str, int]] = {(start + timedelta(days=n)).isoformat(): {e: 0 for e in EVENTS} for n in range(2 * days)}
    for day, name, n in rows:
        if name in EVENTS and day.isoformat() in series:
            series[day.isoformat()][name] = n
    ordered = list(series.items())
    previous, current = ordered[:days], ordered[days:]
    total = lambda part, *names: sum(c.get(n, 0) for _, c in part for n in names)  # noqa: E731
    measures = {"visit": ("visit",), "recommend": ("recommend:food", "recommend:music"), "signup": ("signup",), "login": ("login",),
                "ai": ("ai",), "clientError": ("client_error",), "feedback": ("feedback",), "report": ("report",)}
    now = datetime.now(timezone.utc)
    users = select(func.count()).select_from(User)
    return {
        "days": days,
        "series": [{"day": d, "counts": c} for d, c in current],
        "kpis": {k: {"current": total(current, *names), "previous": total(previous, *names)} for k, names in measures.items()},
        "trackedSince": TRACKED_SINCE,
        "accounts": {
            "total": session.scalar(users) or 0,
            "confirmed": session.scalar(users.where(User.email_verified_at.is_not(None))) or 0,
            "suspended": session.scalar(users.where(User.suspended_at.is_not(None))) or 0,
            "admins": session.scalar(users.where(User.is_admin)) or 0,
            "newInPeriod": session.scalar(users.where(User.created_at >= now - timedelta(days=days))) or 0,
            "loggedInWeek": session.scalar(users.where(User.last_login_at >= now - timedelta(days=7))) or 0,
        },
        "todo": {
            "openReports": session.scalar(select(func.count()).select_from(Report).where(Report.status == "open")) or 0,
            "newFeedback": session.scalar(select(func.count()).select_from(Feedback).where(Feedback.status == "new")) or 0,
            "clientErrorsToday": series[end.isoformat()].get("client_error", 0),
        },
        "quotas": _quotas(session, settings),
    }


def _quotas(session: Session, settings: Settings) -> list[dict]:
    """Today's use of the service's own daily limits (usage_daily; the day turns at midnight KST). 0 = no limit."""
    return [{"key": key, "label": label, "used": used(session, key), "limit": limit} for key, label, limit in (
        (TOTAL, "AI 호출", settings.ai_daily_limit), ("yt:all", "YouTube 검색", settings.youtube_daily_limit),
        ("verify:total", "가입 확인 메일", settings.verify_daily_total), ("reset:total", "비밀번호 재설정 메일", settings.reset_daily_total),
        ("feedback:total", "의견", settings.feedback_daily_total), ("report:total", "오류 신고", settings.report_daily_total))]


# ---- members ----

class MemberSearch(BaseModel):
    q: Annotated[str, StringConstraints(max_length=120, strip_whitespace=True)] = ""
    filter: Literal["all", "confirmed", "unconfirmed", "admin", "suspended", "withData"] = "all"
    sort: Literal["created", "login", "email"] = "created"
    order: Literal["asc", "desc"] = "desc"
    page: int = Field(1, ge=1, le=10_000)
    size: int = Field(25, ge=5, le=100)


def _member_row(user: User) -> dict:
    return {"id": str(user.id), "email": mask_email(user.email), "name": mask_name(user.name), "createdAt": _iso(user.created_at),
            "lastLoginAt": _iso(user.last_login_at), "verified": user.email_verified_at is not None, "isAdmin": user.is_admin,
            "suspended": user.suspended_at is not None, "hasData": user.store is not None}


@router.post("/api/admin/members/search")
def search_members(search: MemberSearch, admin: Admin, session: Session = Depends(get_session)):
    """Members, a page at a time. The address is masked here; it is whole only in one member's details."""
    query = select(User)
    if search.q:
        query = query.where(or_(User.email.ilike(_like(search.q.lower()), escape="\\"), User.name.ilike(_like(search.q), escape="\\")))
    query = query.where(*{
        "all": (), "confirmed": (User.email_verified_at.is_not(None),), "unconfirmed": (User.email_verified_at.is_(None),),
        "admin": (User.is_admin,), "suspended": (User.suspended_at.is_not(None),), "withData": (User.store.is_not(None),),
    }[search.filter])
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    column = {"created": User.created_at, "login": User.last_login_at, "email": User.email}[search.sort]
    ordering = column.desc().nulls_last() if search.order == "desc" else column.asc().nulls_last()
    rows = session.scalars(query.order_by(ordering, User.id).offset((search.page - 1) * search.size).limit(search.size)).all()
    return {"members": [_member_row(u) for u in rows], "total": total, "page": search.page, "size": search.size}


def _store_counts(store: dict | None) -> dict[str, int]:
    """How much is saved, never what: the lists' lengths (src/domain.ts Store)."""
    if not isinstance(store, dict):
        return {}
    profiles = store.get("profiles") if isinstance(store.get("profiles"), dict) else {}
    liked = sum(len(p["selected"]) for p in profiles.values() if isinstance(p, dict) and isinstance(p.get("selected"), list))
    out = {"favorites": store.get("favorites"), "history": store.get("history"), "presets": store.get("presets")}
    counts = {k: len(v) for k, v in out.items() if isinstance(v, list)}
    counts["liked"] = liked
    counts["tasteTypes"] = len(store.get("tasteTypes") or {}) if isinstance(store.get("tasteTypes"), dict) else 0
    return counts


def _member(session: Session, user: User, settings: Settings) -> dict:
    import json
    store_bytes = len(json.dumps(user.store, ensure_ascii=False).encode()) if user.store is not None else 0
    reports = dict(session.execute(select(Report.status, func.count()).where(Report.user_id == user.id).group_by(Report.status)).all())
    history = session.scalars(select(AdminAudit).where(AdminAudit.target_type == "member", AdminAudit.target_id == str(user.id),
                                                       AdminAudit.action != "view_member").order_by(AdminAudit.id.desc()).limit(20)).all()
    return {
        **_member_row(user), "email": user.email, "name": user.name,
        "verifiedAt": _iso(user.email_verified_at), "suspendedAt": _iso(user.suspended_at), "suspendedReason": user.suspended_reason,
        "termsVersion": user.terms_version, "termsAgreedAt": _iso(user.terms_agreed_at),
        "store": {"bytes": store_bytes, "version": user.store_version, "updatedAt": _iso(user.store_updated_at), "counts": _store_counts(user.store)},
        "aiToday": {"used": used(session, f"ai:u:{user.id}"), "limit": settings.ai_daily_per_member},
        "reports": {s: reports.get(s, 0) for s in ("open", "resolved", "dismissed")},
        "actions": [_audit_row(a) for a in history],
    }


def _get_member(session: Session, member_id: uuid.UUID, lock: bool = False) -> User:
    user = session.get(User, member_id, with_for_update=lock)
    if user is None:
        raise HTTPException(404, "회원을 찾지 못했어요.")
    return user


@router.get("/api/admin/members/{member_id}")
def member_details(member_id: uuid.UUID, admin: Admin, session: Session = Depends(get_session), settings: Settings = Depends(get_settings)):
    user = _get_member(session, member_id)
    audit(session, admin, "view_member", "member", str(user.id), who=mask_email(user.email))
    session.commit()
    return _member(session, user, settings)


class Suspension(BaseModel):
    reason: Reason
    notify: bool = True


class Because(BaseModel):
    reason: Note = ""


def _not_self_or_admin(admin: User, user: User, what: str) -> None:
    if user.id == admin.id:
        raise HTTPException(409, f"내 계정은 {what}할 수 없어요.")
    if user.is_admin:
        raise HTTPException(409, f"관리자 계정은 {what}할 수 없어요. 먼저 서버 명령으로 관리자 권한을 거둬주세요.")


@router.post("/api/admin/members/{member_id}/suspend")
def suspend_member(member_id: uuid.UUID, request: Suspension, admin: Admin, session: Session = Depends(get_session),
                   settings: Settings = Depends(get_settings), mailer: Mailer | None = Depends(get_mailer)):
    """Stops the account (terms: 이용 제한): its tokens end now, it cannot sign in or reset its password. The reason is
    mailed to the account's address unless the admin says not to (the terms allow telling it right after an urgent stop)."""
    user = _get_member(session, member_id, lock=True)
    _not_self_or_admin(admin, user, "정지")
    if user.suspended_at is not None:
        raise HTTPException(409, "이미 정지된 계정이에요.")
    session.execute(update(User).where(User.id == user.id).values(suspended_at=datetime.now(timezone.utc), suspended_reason=request.reason,
                                                                   token_version=User.token_version + 1))
    record = AdminAudit(actor_id=admin.id, actor_email=admin.email, action="suspend", target_type="member", target_id=str(user.id),
                        reason=request.reason, detail={"notified": False, "who": mask_email(user.email)})
    session.add(record)
    session.commit()  # the stop holds before any mail goes: no notice for a suspension that did not happen
    mailed = False
    if request.notify and mailer is not None:
        try:
            mailer.send(user.email, *suspend_mail(request.reason, f"{settings.public_app_url.rstrip('/')}/#/terms"))
            mailed = True
        except Exception as error:  # noqa: BLE001 - the stop holds; the admin is told the mail did not go
            import logging
            logging.getLogger(__name__).error("suspension notice could not be sent: %s", mail_failure(error))
        if mailed:
            record.detail = {**record.detail, "notified": True}
            try:
                session.commit()
            except Exception:  # noqa: BLE001 - the mail went; only the record of it is missing, which the log says
                session.rollback()
                import logging
                logging.getLogger(__name__).exception("suspension notice went, but the record could not say so")
    session.refresh(user)
    return {**_member(session, user, settings), "mailed": mailed}


@router.post("/api/admin/members/{member_id}/unsuspend")
def unsuspend_member(member_id: uuid.UUID, request: Because, admin: Admin, session: Session = Depends(get_session), settings: Settings = Depends(get_settings)):
    user = _get_member(session, member_id, lock=True)
    if user.suspended_at is None:
        raise HTTPException(409, "정지된 계정이 아니에요.")
    # Tokens issued in the moment before the suspension do not come back to life with the release.
    session.execute(update(User).where(User.id == user.id).values(suspended_at=None, suspended_reason=None, token_version=User.token_version + 1))
    audit(session, admin, "unsuspend", "member", str(user.id), request.reason, who=mask_email(user.email))
    session.commit()
    return _member(session, user, settings)


@router.post("/api/admin/members/{member_id}/signout")
def sign_out_member(member_id: uuid.UUID, request: Because, admin: Admin, session: Session = Depends(get_session), settings: Settings = Depends(get_settings)):
    """Ends every sign-in of the account (a lost phone, a shared computer); the person signs in again with the password."""
    user = _get_member(session, member_id, lock=True)
    if user.id == admin.id:
        raise HTTPException(409, "내 계정은 설정의 '모든 기기에서 로그아웃'을 써주세요.")
    session.execute(update(User).where(User.id == user.id).values(token_version=User.token_version + 1))
    audit(session, admin, "signout", "member", str(user.id), request.reason, who=mask_email(user.email))
    session.commit()
    session.refresh(user)
    return _member(session, user, settings)


# ---- recommendations and AI ----

def _engine(params: dict | None) -> str:
    return "ai" if (params or {}).get("engine") == "ai" else "catalog"


def _error_code(error: str | None) -> str | None:
    """The pipeline writes codes ("rerank:TimeoutError;query_embedding:…"); only their names go out, cut short."""
    if not error:
        return None
    return ";".join(part.split(" ")[0][:40] for part in error.split(";")[:3])


def _pct(values: list[int], q: int) -> int | None:
    if not values:
        return None
    return values[0] if len(values) == 1 else round(statistics.quantiles(values, n=100)[q - 1])


@router.get("/api/admin/recommendations")
def recommendations(admin: Admin, days: int = 30, kind: Literal["all", "failed", "catalog"] = "all", category: Literal["all", "food", "music"] = "all",
                    page: int = 1, session: Session = Depends(get_session)):
    """Day by day (requests, AI or catalog answer, errors, speed) and the latest requests of one kind. No request text,
    account or address: conditions, engine, speed and error codes only."""
    if not 1 <= days <= 90 or not 1 <= page <= 200:
        raise HTTPException(422, "기간은 1일에서 90일 사이로 골라주세요.")
    now = datetime.now(KST)
    first = (now - timedelta(days=days - 1)).date()
    since = datetime.combine(first, datetime.min.time(), KST)
    where = [RecommendationLog.created_at >= since] + ([RecommendationLog.category == category] if category != "all" else [])
    rows = session.execute(select(RecommendationLog.created_at, RecommendationLog.params, RecommendationLog.latency_ms, RecommendationLog.error)
                           .where(*where)).all()
    by_day = {(first + timedelta(days=n)).isoformat(): {"requests": 0, "ai": 0, "catalog": 0, "errors": 0, "latency": []} for n in range(days)}
    for at, params, latency, error in rows:
        d = by_day.get(_aware(at).astimezone(KST).date().isoformat())
        if d is None:
            continue
        d["requests"] += 1
        d[_engine(params)] += 1
        d["errors"] += bool(error)
        if latency is not None:
            d["latency"].append(latency)
    all_latency = [v for d in by_day.values() for v in d["latency"]]
    trend = [{"day": day, **{k: v for k, v in d.items() if k != "latency"}, "p50": _pct(d["latency"], 50), "p95": _pct(d["latency"], 95)}
             for day, d in by_day.items()]
    calls = dict(session.execute(select(StatsDaily.day, StatsDaily.count).where(StatsDaily.name == "ai", StatsDaily.day >= first)).all())
    for point in trend:
        point["aiCalls"] = calls.get(date.fromisoformat(point["day"]), 0)
    listing = select(RecommendationLog).where(*where)
    if kind == "failed":
        listing = listing.where(RecommendationLog.error.is_not(None))
    elif kind == "catalog":
        listing = listing.where(or_(RecommendationLog.params["engine"].as_string().is_(None), RecommendationLog.params["engine"].as_string() != "ai"))
    size = 30
    logs = session.scalars(listing.order_by(RecommendationLog.created_at.desc()).offset((page - 1) * size).limit(size + 1)).all()
    return {
        "days": days, "trend": trend, "trackedSince": TRACKED_SINCE,
        "summary": {"requests": len(rows), "ai": sum(d["ai"] for d in trend), "catalog": sum(d["catalog"] for d in trend),
                    "errors": sum(d["errors"] for d in trend), "p50": _pct(all_latency, 50), "p95": _pct(all_latency, 95),
                    "aiCalls": sum(calls.values())},
        "recent": [{"id": str(r.id), "at": _iso(r.created_at), "category": r.category, "engine": _engine(r.params), "latencyMs": r.latency_ms,
                    "error": _error_code(r.error), "tags": (r.conditions or {}).get("tags") or [], "excluded": (r.conditions or {}).get("excluded") or [],
                    "results": len(r.result_ids or []), "issues": (r.params or {}).get("issues") or ""} for r in logs[:size]],
        "more": len(logs) > size,
    }


# ---- system ----

@router.get("/api/admin/system")
def system(admin: Admin, session: Session = Depends(get_session), settings: Settings = Depends(get_settings)):
    db = check_database()
    first = today() - timedelta(days=13)
    errors = dict(session.execute(select(StatsDaily.day, StatsDaily.count).where(StatsDaily.name == "client_error", StatsDaily.day >= first)).all())
    return {
        "server": {"revision": os.environ.get("K_REVISION"), "service": os.environ.get("K_SERVICE"), "now": datetime.now(KST).isoformat()},
        "database": {"ok": db.ok, "revision": db.revision, "pgvector": db.pgvector_installed},
        "integrations": [
            {"key": "llm", "label": "AI 모델(Gemini)", "on": bool(settings.gemini_api_key)},
            {"key": "mail", "label": "메일 발송", "on": bool(settings.smtp_host and settings.mail_from)},
            {"key": "youtube", "label": "YouTube 검색", "on": bool(settings.youtube_api_key)},
            {"key": "auth", "label": "계정·로그인", "on": bool(settings.auth_secret)},
            {"key": "verify", "label": "가입 이메일 확인", "on": settings.email_verification},
            {"key": "proxy", "label": "프록시 주소 신뢰(접속 IP)", "on": settings.trust_proxy},
        ],
        "quotas": _quotas(session, settings),
        "limits": {"aiPerMember": settings.ai_daily_per_member, "aiPerGuest": settings.ai_daily_per_guest,
                   "perMinute": settings.rate_limit_per_minute, "perMinuteGuest": settings.rate_limit_guest_per_minute},
        "clientErrors": [{"day": (first + timedelta(days=n)).isoformat(), "count": errors.get(first + timedelta(days=n), 0)} for n in range(14)],
        "trackedSince": TRACKED_SINCE,
        "retention": [{"label": "접속 기록(IP)", "days": ACCESS_DAYS}, {"label": "의견", "days": FEEDBACK_DAYS},
                      {"label": "이용 통계", "days": STATS_DAYS}, {"label": "관리자 조치 기록", "days": AUDIT_DAYS}],
    }


# ---- access list: one address ----

class AddressLook(BaseModel):
    address: Annotated[str, StringConstraints(min_length=3, max_length=64, strip_whitespace=True)]


@router.post("/api/admin/access/address")
def address_history(look: AddressLook, admin: Admin, session: Session = Depends(get_session)):
    """What the 30-day access list holds for one address (or IPv6 /64): when it came, how often, for what. Looking is
    recorded, as it is a look at one place's history."""
    address = look.address
    since = datetime.now(KST) - timedelta(days=ACCESS_DAYS)
    rows = session.execute(select(AccessLog.at, AccessLog.event).where(AccessLog.address == address, AccessLog.at >= since).order_by(AccessLog.at)).all()
    audit(session, admin, "view_address", "address", address)
    session.commit()
    days: dict[str, int] = {}
    events: dict[str, int] = {}
    for at, event in rows:
        day = _aware(at).astimezone(KST).date().isoformat()
        days[day] = days.get(day, 0) + 1
        events[event] = events.get(event, 0) + 1
    return {"address": address, "total": len(rows), "first": _iso(rows[0][0]) if rows else None, "last": _iso(rows[-1][0]) if rows else None,
            "events": events, "days": [{"day": d, "count": n} for d, n in days.items()]}


# ---- content ----

class ItemSearch(BaseModel):
    q: Annotated[str, StringConstraints(max_length=80, strip_whitespace=True)] = ""
    category: Literal["all", "food", "music"] = "all"
    status: Literal["all", "reviewed", "draft", "rejected", "hidden"] = "reviewed"
    source: Literal["all", "seed", "ai_draft", "user_request"] = "all"
    page: int = Field(1, ge=1, le=10_000)
    size: int = Field(30, ge=5, le=100)


def _item_row(item: Item, open_reports: int = 0) -> dict:
    return {"id": item.id, "category": item.category, "name": item.name, "artist": item.artist, "subtitle": item.subtitle, "tags": item.tags,
            "status": item.status, "source": item.source, "hiddenAt": _iso(item.hidden_at), "emoji": item.emoji, "color": item.color,
            "releaseYear": item.release_year, "updatedAt": _iso(item.updated_at), "openReports": open_reports}


@router.post("/api/admin/items/search")
def search_items(search: ItemSearch, admin: Admin, session: Session = Depends(get_session)):
    query = select(Item)
    if search.q:
        query = query.where(or_(Item.name.ilike(_like(search.q), escape="\\"), Item.artist.ilike(_like(search.q), escape="\\"), Item.id == search.q))
    if search.category != "all":
        query = query.where(Item.category == search.category)
    if search.status == "hidden":
        query = query.where(Item.hidden_at.is_not(None))
    elif search.status != "all":
        query = query.where(Item.status == search.status, Item.hidden_at.is_(None))  # hidden ones are listed under "hidden"
    if search.source != "all":
        query = query.where(Item.source == search.source)
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = session.scalars(query.order_by(Item.updated_at.desc(), Item.id).offset((search.page - 1) * search.size).limit(search.size)).all()
    reports = dict(session.execute(select(Report.item_id, func.count()).where(Report.status == "open", Report.item_id.in_([r.id for r in rows]))
                                   .group_by(Report.item_id)).all()) if rows else {}
    counts = dict(session.execute(select(Item.status, func.count()).where(Item.hidden_at.is_(None)).group_by(Item.status)).all())
    counts["hidden"] = session.scalar(select(func.count()).select_from(Item).where(Item.hidden_at.is_not(None))) or 0
    return {"items": [_item_row(r, reports.get(r.id, 0)) for r in rows], "total": total, "page": search.page, "size": search.size, "counts": counts}


def _item_details(session: Session, item: Item) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=30)
    shown = session.scalar(select(func.count()).select_from(RecommendationLog).where(RecommendationLog.created_at >= since,
                                                                                    literal(item.id) == any_(RecommendationLog.result_ids))) or 0
    reports = session.scalars(select(Report).where(Report.item_id == item.id).order_by(Report.created_at.desc()).limit(20)).all()
    history = session.scalars(select(AdminAudit).where(AdminAudit.target_type == "item", AdminAudit.target_id == item.id)
                              .order_by(AdminAudit.id.desc()).limit(20)).all()
    return {**_item_row(item, sum(r.status == "open" for r in reports)), "description": item.description, "ingredients": item.ingredients,
            "parentId": item.parent_id, "aiFields": item.ai_fields, "reviewNotes": item.review_notes, "createdAt": _iso(item.created_at),
            "reviewedAt": _iso(item.reviewed_at), "shown30d": shown,
            "reports": [{"id": str(r.id), "at": _iso(r.created_at), "kind": r.kind, "note": r.note, "status": r.status} for r in reports],
            "actions": [_audit_row(a) for a in history]}


def _get_item(session: Session, item_id: str) -> Item:
    item = session.get(Item, item_id, with_for_update=True)
    if item is None:
        raise HTTPException(404, "항목을 찾지 못했어요.")
    return item


@router.get("/api/admin/items/{item_id}")
def item_details(item_id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,39}$")], admin: Admin, session: Session = Depends(get_session)):
    item = session.get(Item, item_id)
    if item is None:
        raise HTTPException(404, "항목을 찾지 못했어요.")
    return _item_details(session, item)


@router.post("/api/admin/items/{item_id}/hide")
def hide_item(item_id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,39}$")], request: Suspension, admin: Admin,
              session: Session = Depends(get_session)):
    """Out of new recommendations and the published catalog; the AI is asked to avoid it and its answer is dropped if it
    names it anyway. Favourites and history that hold it already keep it. The seed job leaves it hidden."""
    item = _get_item(session, item_id)
    if item.hidden_at is not None:
        raise HTTPException(409, "이미 숨긴 항목이에요.")
    item.hidden_at = datetime.now(timezone.utc)
    audit(session, admin, "hide_item", "item", item.id, request.reason, name=item.name)
    session.commit()
    return _item_details(session, item)


@router.post("/api/admin/items/{item_id}/show")
def show_item(item_id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,39}$")], request: Because, admin: Admin,
              session: Session = Depends(get_session)):
    """Undoes hide only: the review status stays what the catalog says (an item taken out of the published file stays out)."""
    item = _get_item(session, item_id)
    if item.hidden_at is None:
        raise HTTPException(409, "숨긴 항목이 아니에요.")
    item.hidden_at = None
    audit(session, admin, "show_item", "item", item.id, request.reason, name=item.name)
    session.commit()
    return _item_details(session, item)


# ---- the action record ----

def _audit_row(a: AdminAudit) -> dict:
    return {"id": a.id, "at": _iso(a.at), "actor": a.actor_email, "action": a.action, "targetType": a.target_type, "targetId": a.target_id,
            "reason": a.reason, "detail": a.detail or {}}


@router.get("/api/admin/audit")
def audit_list(admin: Admin, before: int | None = None, action: str | None = None, targetType: str | None = None, session: Session = Depends(get_session)):
    query = select(AdminAudit).order_by(AdminAudit.id.desc()).limit(51)
    if before is not None:
        query = query.where(AdminAudit.id < before)
    if action:
        query = query.where(AdminAudit.action == action)
    if targetType:
        query = query.where(AdminAudit.target_type == targetType)
    rows = session.scalars(query).all()
    return {"entries": [_audit_row(a) for a in rows[:50]], "more": len(rows) > 50}

"""The browser's side of the daily counts, and the admin dashboard that reads them (stats.py, 2026-11-23)."""
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..budget import Allowance, guest_key
from ..config import Settings, get_settings
from ..db import get_session
from ..models import Feedback, Report, StatsDaily, User
from ..ratelimit import client_address
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
        count(session, request.event)
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

"""Daily counts for the admin dashboard (2026-11-23): how many browsers came, and what they used.

A count is one row per day (KST) and name, raised by one. Nothing that names a person, a browser or an address is kept:
the server counts its own features where they happen (`count`), and the browser tells the few that happen only on its
side through POST /api/stats (routes/stats.py), among them its first visit of the day. Counting never fails a request:
an error is logged and the request goes on.
"""
import logging
from datetime import date, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from .budget import KST

log = logging.getLogger(__name__)

# What the server counts itself.
SERVER_EVENTS = ("recommend:food", "recommend:music", "youtube", "signup", "verify", "login", "feedback", "report")
# What a browser may report: its first visit of the day (by its own clock, KST), and features that make no request.
CLIENT_EVENTS = ("visit", "pair", "type:food", "type:music")
EVENTS = SERVER_EVENTS + CLIENT_EVENTS
KEEP_DAYS = 400  # a little over a year, so last year's same month can be compared (retention.py removes older days)

_BUMP = text("INSERT INTO stats_daily (day, name, count) VALUES (:day, :name, 1) "
             "ON CONFLICT (day, name) DO UPDATE SET count = stats_daily.count + 1")


def today() -> date:
    return datetime.now(KST).date()


def count(session: Session, name: str, day: date | None = None) -> None:
    """One more `name` today, on a connection of its own: the request's session (its open transaction, the objects it
    holds) is not committed, rolled back or expired by it. Whatever goes wrong is only logged."""
    if name not in EVENTS:
        raise ValueError(name)
    try:
        with session.get_bind().connect() as connection:
            connection.execute(_BUMP, {"day": day or today(), "name": name})
            connection.commit()
    except Exception:  # noqa: BLE001 - a lost count must not cost anyone their recommendation
        log.exception("stats: could not count %s", name)

"""What is removed once a day (2026-11-18): sign-ups never confirmed, and feedback older than a year (and since
2026-11-26 admin actions older than two years).

Run with the first count of a day (budget.take), the same moment the old daily counters go, so it happens on any day the
service is used without a scheduler. Each removal is one DELETE whose conditions are checked by the database itself, so
a confirmation arriving at the same moment either lands first (and the account is no longer a match) or finds nothing.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete
from sqlalchemy.orm import Session

from .config import Settings
from .models import AccessLog, AdminAudit, Feedback, StatsDaily, User

log = logging.getLogger(__name__)
FEEDBACK_DAYS = 365
STATS_DAYS = 400  # the dashboard's counts (stats.py KEEP_DAYS)
ACCESS_DAYS = 30  # the access list (privacy policy: 접속 기록 30일)
AUDIT_DAYS = 730  # what admins did and looked at (admin console, 2026-11-26): two years, as the safety-measures standard asks of a system holding sensitive data


def stale_signup(settings: Settings, now: datetime | None = None):
    """The accounts that may go: never confirmed, never signed in (a confirmed sign-in or a reset sets last_login_at),
    holding no saved data, not an admin, and made longer ago than the keeping days plus the life of a confirmation link
    (links are mailed only within the keeping days, so none still works). Accounts from before confirmation existed were
    all signed in once and never match."""
    now = now or datetime.now(timezone.utc)
    made_before = now - timedelta(days=settings.unverified_keep_days, hours=settings.verify_link_hours)
    return (User.email_verified_at.is_(None), User.last_login_at.is_(None), User.store.is_(None), User.is_admin.is_(False),
            User.suspended_at.is_(None),  # a suspension is not undone by signing up again (2026-11-26)
            User.created_at < made_before)


def sweep(session: Session, settings: Settings, now: datetime | None = None) -> tuple[int, int]:
    now = now or datetime.now(timezone.utc)
    # Decided by the database alone (no rows held by this session are looked at or updated).
    plain = {"synchronize_session": False}
    accounts = session.execute(delete(User).where(*stale_signup(settings, now)), execution_options=plain).rowcount
    said = session.execute(delete(Feedback).where(Feedback.created_at < now - timedelta(days=FEEDBACK_DAYS)), execution_options=plain).rowcount
    session.execute(delete(StatsDaily).where(StatsDaily.day < (now - timedelta(days=STATS_DAYS)).date()), execution_options=plain)
    session.execute(delete(AccessLog).where(AccessLog.at < now - timedelta(days=ACCESS_DAYS)), execution_options=plain)
    session.execute(delete(AdminAudit).where(AdminAudit.at < now - timedelta(days=AUDIT_DAYS)), execution_options=plain)
    session.commit()
    if accounts or said:
        log.info("removed %d unconfirmed sign-ups and %d year-old feedback", accounts, said)
    return accounts, said

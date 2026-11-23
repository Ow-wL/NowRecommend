"""A short mail to the operator once a day (2026-11-23): how much feedback and how many error reports came in since the
last one. Counts only, never what was written: the mail goes through the mail service (Resend), and the privacy policy
sends it nothing that people wrote. Off unless FEEDBACK_DIGEST_TO names an address.

Sent from the daily run (budget.forget_old), so on any day the service is used. The window starts at the last day that
run happened (its "sweep:day" mark, kept 7 days), so a quiet day in between is not left out.
"""
import logging
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import Settings
from .mail import Mailer, digest_mail, failure as mail_failure
from .models import Feedback, Report, UsageDaily

log = logging.getLogger(__name__)
KINDS = ("problem", "idea", "praise", "other")


def window_start(session: Session, today: date, kst) -> datetime:
    """Midnight (KST) of the last day before today that the daily run happened; a week back if none is known."""
    last = session.scalar(select(func.max(UsageDaily.day)).where(UsageDaily.bucket == "sweep:day", UsageDaily.day < today))
    return datetime.combine(last or today - timedelta(days=7), time(0), kst)


def send_digest(session: Session, settings: Settings, mailer: Mailer | None, today: date, kst) -> bool:
    """True if a mail left. Nothing is sent when nothing came in, or when it is not set up."""
    to = settings.feedback_digest_to.strip()
    if not to or mailer is None:
        return False
    start, end = window_start(session, today, kst), datetime.combine(today, time(0), kst)
    since, until = start.astimezone(timezone.utc), end.astimezone(timezone.utc)  # stored times are compared in UTC
    said = dict(session.execute(select(Feedback.kind, func.count()).where(Feedback.created_at >= since, Feedback.created_at < until)
                                .group_by(Feedback.kind)).all())
    reports = session.scalar(select(func.count()).select_from(Report).where(Report.created_at >= since, Report.created_at < until)) or 0
    if not sum(said.values()) and not reports:
        return False
    counts = {kind: int(said.get(kind, 0)) for kind in KINDS}
    admin = f"{settings.public_app_url.rstrip('/')}/#/admin"
    try:
        mailer.send(to, *digest_mail(counts, int(reports), start.date(), (end - timedelta(days=1)).date(), admin))
        return True
    except Exception as error:  # noqa: BLE001 - tomorrow's mail counts from tomorrow's window; the admin page has it all
        log.error("feedback digest could not be sent: %s", mail_failure(error))
        return False

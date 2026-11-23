"""The operator's daily count of feedback and error reports (2026-11-23). On SQLite, with a mailer that only remembers."""
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.budget import KST, forget_old
from app.config import Settings, get_settings
from app.digest import send_digest
from app.mail import digest_mail
from app.models import Feedback, Report, UsageDaily, User

TODAY = date(2026, 11, 23)


class Outbox:
    def __init__(self, fails=False):
        self.sent, self.fails = [], fails

    def send(self, to, subject, text, html=None):
        if self.fails:
            raise OSError("smtp is down")
        self.sent.append({"to": to, "subject": subject, "text": text, "html": html})


@pytest.fixture
def session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for table in (User, UsageDaily, Feedback, Report):
        table.__table__.create(engine)
    with sessionmaker(engine, expire_on_commit=False)() as s:
        yield s


def at(day: date, hour: int) -> datetime:
    return datetime(day.year, day.month, day.day, hour, tzinfo=KST).astimezone(timezone.utc)


def settings(**more):
    return Settings(**{"public_app_url": "https://nowrec.kr/", "feedback_digest_to": "op@example.com", **more})


def add_feedback(s, kind, when):
    s.add(Feedback(kind=kind, message="쓴 내용은 메일에 가면 안 돼요", contact="writer@example.com", created_at=when))


def test_counts_since_the_last_daily_run_and_never_what_was_written(session):
    session.add(UsageDaily(day=TODAY - timedelta(days=3), bucket="digest:sent", count=1))  # the last mail: three days ago
    session.add(UsageDaily(day=TODAY - timedelta(days=1), bucket="sweep:day", count=1))  # a run whose mail failed: not a start
    add_feedback(session, "problem", at(TODAY - timedelta(days=4), 12))  # before the window: was in that day's mail
    add_feedback(session, "problem", at(TODAY - timedelta(days=3), 9))
    add_feedback(session, "idea", at(TODAY - timedelta(days=1), 23))
    add_feedback(session, "idea", at(TODAY, 1))  # today: tomorrow's mail
    session.add(Report(item_id="f01", category="food", item_name="김치찌개", item_subtitle="", kind="wrong_image", note="", created_at=at(TODAY - timedelta(days=2), 8)))
    session.commit()
    outbox = Outbox()
    assert send_digest(session, settings(), outbox, TODAY, KST)
    [mail] = outbox.sent
    assert mail["to"] == "op@example.com"
    assert mail["subject"] == "[지금 추천] 새 의견 2건, 오류 신고 1건 (11/20~11/22)"
    assert "불편·오류 1" in mail["text"] and "제안 1" in mail["text"] and "https://nowrec.kr/#/admin" in mail["text"]
    for part in (mail["text"], mail["html"]):
        assert "쓴 내용" not in part and "writer@example.com" not in part and "김치찌개" not in part


def test_nothing_is_sent_when_nothing_came_or_nobody_is_named(session):
    outbox = Outbox()
    assert not send_digest(session, settings(), outbox, TODAY, KST)
    add_feedback(session, "praise", at(TODAY - timedelta(days=1), 10))
    session.commit()
    assert not send_digest(session, settings(feedback_digest_to=""), outbox, TODAY, KST)
    assert not send_digest(session, settings(), None, TODAY, KST)
    assert outbox.sent == []
    assert not send_digest(session, settings(), Outbox(fails=True), TODAY, KST)  # a failure is logged, not raised


def test_a_failed_mail_leaves_its_days_for_the_next_one(session):
    add_feedback(session, "problem", at(TODAY - timedelta(days=2), 10))
    session.commit()
    assert not send_digest(session, settings(), Outbox(fails=True), TODAY - timedelta(days=1), KST)
    outbox = Outbox()
    assert send_digest(session, settings(), outbox, TODAY, KST)
    assert "새 의견 1건" in outbox.sent[0]["subject"]
    assert not send_digest(session, settings(), Outbox(), TODAY + timedelta(days=1), KST)  # counted from today on: nothing new


def test_the_daily_run_sends_it_once(session, monkeypatch):
    add_feedback(session, "other", at(TODAY - timedelta(days=1), 10))
    session.commit()
    outbox = Outbox()
    monkeypatch.setattr("app.budget.get_settings", lambda: settings())
    monkeypatch.setattr("app.mail.get_mailer", lambda: outbox)
    forget_old(session, TODAY)
    forget_old(session, TODAY)  # a second first-count of the same day: the mark is there, nothing more
    assert len(outbox.sent) == 1 and "11/16~11/22" in outbox.sent[0]["subject"]  # no earlier run known: the week before


def test_one_day_is_named_alone():
    subject, text, html = digest_mail({"problem": 0, "idea": 0, "praise": 3, "other": 0}, 0, date(2026, 11, 22), date(2026, 11, 22), "https://nowrec.kr/#/admin")
    assert subject == "[지금 추천] 새 의견 3건, 오류 신고 0건 (11/22)"
    assert "칭찬 3" in text and "불편" not in text

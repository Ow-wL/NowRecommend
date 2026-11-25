"""The admin page's access list and insights, and the security review's fixes of 2026-11-24 (login spraying, mails to
made-up sign-ups, names in mails, a day's error reports, password checks at once)."""
import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import auth as auth_module
from app.auth import TokenSigner
from app.config import Settings, get_settings
from app.db import get_session
from app.llm.free import WEB
from app.mail import get_mailer
from app.main import create_app
from app.models import AccessLog, AdminAudit, Feedback, Item, RecommendationLog, Report, StatsDaily, UsageDaily, User
from app.retention import sweep
from app.routes.auth import get_signer
from tests.conftest import needs_db

SIGNUP = {"email": "lee@example.com", "password": "password1", "name": "주형"}


class Outbox:
    def __init__(self):
        self.sent = []

    def send(self, to, subject, text, html=None):
        self.sent.append(to)


def settings(**more):
    return Settings(public_app_url="https://app.example.com/", auth_secret="test-secret", signup_daily_per_address=0, **more)


@pytest.fixture
def world():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for table in (User, UsageDaily, Feedback, StatsDaily, Report, AccessLog, AdminAudit):
        table.__table__.create(engine)
    make = sessionmaker(engine, expire_on_commit=False)

    def session():
        with make() as s:
            yield s

    outbox, signer, app = Outbox(), TokenSigner("test-secret", ttl_seconds=3600), create_app()
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[get_signer] = lambda: signer
    app.dependency_overrides[get_mailer] = lambda: outbox
    app.dependency_overrides[get_settings] = lambda: settings()
    with TestClient(app) as client:
        yield client, outbox, app, make, signer


def admin_header(make, signer):
    with make() as s:
        admin = User(email="admin@example.com", name="관리자", password_hash="x", is_admin=True, email_verified_at=datetime.now(timezone.utc))
        s.add(admin)
        s.commit()
        return {"Authorization": f"Bearer {signer.issue(str(admin.id))}"}


def test_coming_in_is_listed_with_the_address_for_an_admin_only(world):
    client, _, app, make, signer = world
    app.dependency_overrides[get_settings] = lambda: settings(trust_proxy=True)
    there = {"X-Forwarded-For": "203.0.113.5"}  # the address the proxy saw
    client.post("/api/auth/signup", json=SIGNUP, headers=there)
    client.post("/api/auth/login", json={"email": SIGNUP["email"], "password": SIGNUP["password"]}, headers=there)
    client.post("/api/stats", json={"event": "visit"}, headers=there)
    client.post("/api/stats", json={"event": "pair"}, headers=there)  # a feature, not coming in: counted, not listed
    with make() as s:
        member = s.scalar(select(User).where(User.email == SIGNUP["email"]))
    assert client.get("/api/admin/access", headers={"Authorization": f"Bearer {signer.issue(str(member.id))}"}).status_code == 403
    assert client.get("/api/admin/access").status_code == 401
    page = client.get("/api/admin/access", headers=admin_header(make, signer), params={"limit": 2}).json()
    assert [e["event"] for e in page["entries"]] == ["visit", "login"] and page["more"] is True
    assert {e["address"] for e in page["entries"]} == {"203.0.113.5"}
    rest = client.get("/api/admin/access", headers=admin_header_again(make, signer), params={"before": page["entries"][-1]["id"]}).json()
    assert [e["event"] for e in rest["entries"]] == ["signup"] and rest["more"] is False


def admin_header_again(make, signer):
    with make() as s:
        admin = s.scalar(select(User).where(User.email == "admin@example.com"))
        return {"Authorization": f"Bearer {signer.issue(str(admin.id))}"}


def test_the_access_list_keeps_thirty_days(world):
    _, _, _, make, _ = world
    now = datetime.now(timezone.utc)
    with make() as s:
        s.add_all([AccessLog(address="a", event="visit", at=now - timedelta(days=31)), AccessLog(address="b", event="visit", at=now - timedelta(days=29))])
        s.commit()
        sweep(s, settings(), now)
        assert [r.address for r in s.scalars(select(AccessLog))] == ["b"]


def test_one_place_cannot_try_a_password_across_many_accounts(world):
    client, _, app, _, _ = world
    app.dependency_overrides[get_settings] = lambda: settings(login_fails_per_hour_address=3, rate_limit_per_minute=0)
    answers = [client.post("/api/auth/login", json={"email": f"user{n}@example.com", "password": "password1"}).status_code for n in range(5)]
    assert answers == [401, 401, 401, 429, 429]


def test_a_made_up_sign_up_gets_one_reset_mail_a_day(world):
    client, outbox, app, _, _ = world
    app.dependency_overrides[get_settings] = lambda: settings(email_verification=True)
    client.post("/api/auth/signup", json=SIGNUP)
    sent = len(outbox.sent)
    for _ in range(3):
        assert client.post("/api/auth/reset/request", json={"email": SIGNUP["email"]}).status_code == 202
    assert len(outbox.sent) == sent + 1


def test_a_name_that_is_a_web_address_is_refused():
    for name in ("보안확인 evil.kr", "www.x", "http://x", "확인 evil．info", "님 scam.top"):
        assert WEB.search(name), name
    for name in ("Mr.Children", "주형", "B.B. King", "t.A.T.u."):
        assert not WEB.search(name), name


def test_sign_up_refuses_a_name_with_a_web_address(world):
    client, _, _, _, _ = world
    assert client.post("/api/auth/signup", json={**SIGNUP, "name": "확인 evil.kr"}).status_code == 422


@needs_db
def test_error_reports_have_a_daily_limit_per_place(db_session):
    db_session.add(Item(id="f-report-limit", category="food", name="메뉴", subtitle="한식", description="", tags=[], emoji="", color="", source="ai_draft"))
    db_session.commit()
    app = create_app()
    app.dependency_overrides[get_session] = lambda: db_session
    app.dependency_overrides[get_settings] = lambda: settings(report_daily_per_address=2)
    with TestClient(app) as client:
        answers = [client.post("/api/reports", json={"itemId": "f-report-limit", "kind": "wrong_info", "note": f"{n}"}).status_code for n in range(3)]
    assert answers == [201, 201, 429]


def test_password_checks_wait_their_turn_and_answer_503_past_the_wait(monkeypatch):
    monkeypatch.setattr(auth_module, "HASH_WORKERS", threading.BoundedSemaphore(1))
    monkeypatch.setattr(auth_module, "HASH_WAIT_S", 0.01)
    auth_module.HASH_WORKERS.acquire()  # someone else's check is running
    try:
        with pytest.raises(auth_module.PasswordBusy):
            auth_module.hash_password("password1", iterations=1)
    finally:
        auth_module.HASH_WORKERS.release()
    assert auth_module.verify_password("password1", auth_module.hash_password("password1", iterations=1))


@needs_db
def test_insights_read_the_request_log_accounts_and_access_list(db_session):
    from app.main import create_app as make_app
    signer = TokenSigner("test-secret", ttl_seconds=3600)
    admin = User(email=f"admin-{uuid.uuid4().hex[:6]}@example.com", name="관리자", password_hash="x", is_admin=True, email_verified_at=datetime.now(timezone.utc))
    db_session.add(admin)
    db_session.add(Item(id="m-test-1", category="music", name="곡", artist="가수", subtitle="가수", description="", tags=[], emoji="", color="", source="ai_draft"))
    for latency, issues in ((1000, "extra=4,store_missing=1"), (3000, "store_missing=2")):
        db_session.add(RecommendationLog(category="music", conditions={"tags": ["차분함"], "excluded": []}, params={"engine": "ai", "issues": issues},
                                         candidate_ids=[], candidate_scores={}, result_ids=["m-test-1"], mode="rag", latency_ms=latency))
    db_session.add(RecommendationLog(category="music", conditions={"tags": [], "excluded": []}, params={}, candidate_ids=[], candidate_scores={},
                                     result_ids=[], mode="retrieval_only", latency_ms=500))
    db_session.add_all([AccessLog(address="198.51.100.7", event="visit"), AccessLog(address="198.51.100.7", event="recommend:music")])
    db_session.commit()
    app = make_app()
    app.dependency_overrides[get_session] = lambda: db_session
    app.dependency_overrides[get_signer] = lambda: signer
    app.dependency_overrides[get_settings] = lambda: settings()
    with TestClient(app) as client:
        board = client.get("/api/admin/insights", params={"days": 7}, headers={"Authorization": f"Bearer {signer.issue(str(admin.id))}"}).json()
    music = board["recommendations"]["music"]
    assert (music["requests"], music["ai"], music["fallback"]) == (3, 2, 1)
    assert music["issues"]["store_missing"] == 3
    assert music["topItems"][0] == {"id": "m-test-1", "name": "곡", "artist": "가수", "count": 2}
    assert music["topTags"][0] == {"tag": "차분함", "count": 2}
    assert board["access"]["busiest"][0]["address"] == "198.51.100.7" and board["access"]["busiest"][0]["count"] == 2
    assert sum(board["hours"]) == 3 and board["accounts"]["admins"] >= 1


def test_a_password_never_checked_gives_its_counts_back(world, monkeypatch):
    """Too many checks at once (503) is not a wrong password: nothing is left counted against the account or the place."""
    client, _, app, make, _ = world
    app.dependency_overrides[get_settings] = lambda: settings(rate_limit_per_minute=0)
    monkeypatch.setattr(auth_module, "HASH_WORKERS", threading.BoundedSemaphore(1))
    monkeypatch.setattr(auth_module, "HASH_WAIT_S", 0.01)
    auth_module.absent_hash()  # made before the slot is taken, as at start-up
    auth_module.HASH_WORKERS.acquire()
    try:
        assert client.post("/api/auth/login", json={"email": "who@example.com", "password": "password1"}).status_code == 503
    finally:
        auth_module.HASH_WORKERS.release()
    with make() as s:
        assert all(row.count == 0 for row in s.scalars(select(UsageDaily).where(UsageDaily.bucket.like("login:%"))))


def test_the_access_list_shows_nothing_older_than_thirty_days_and_keeps_only_addresses(world):
    client, _, _, make, signer = world
    from app.stats import count
    with make() as s:
        s.add(AccessLog(address="192.0.2.1", event="visit", at=datetime.now(timezone.utc) - timedelta(days=40)))  # a late removal
        s.commit()
        count(s, "visit", address="not-an-address")
        count(s, "visit", address="2001:db8:1:2::/64")
    page = client.get("/api/admin/access", headers=admin_header(make, signer)).json()
    assert [e["address"] for e in page["entries"]] == ["2001:db8:1:2::/64"]


def test_mails_sent_before_an_address_is_confirmed_do_not_carry_the_typed_name():
    from app.mail import reset_mail, verify_mail
    for subject, text, html in (verify_mail("확인 evil.example", "https://app.example.com/#/verify/t", 24), reset_mail("확인 evil.example", "https://app.example.com/#/reset/t", 30)):
        assert "evil" not in text and "evil" not in html

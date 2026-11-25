"""The admin console (2026-11-26): members (masked list, details recorded as looked at, suspension that holds at every
door), feedback handling, the overview's two periods, the action record, and nothing cached."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import TokenSigner, hash_password
from app.config import Settings, get_settings
from app.db import get_session
from app.mail import get_mailer, suspend_mail
from app.main import create_app
from app.models import AccessLog, AdminAudit, Feedback, Report, StatsDaily, UsageDaily, User
from app.routes.admin import mask_email, mask_name
from app.routes.auth import get_signer
from app.stats import today


class Outbox:
    def __init__(self):
        self.sent = []

    def send(self, to, subject, text, html=None):
        self.sent.append((to, subject, text))


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
        yield client, outbox, make, signer


def person(make, email, admin=False, password="password1", **more):
    with make() as s:
        user = User(email=email, name="이주형" if not admin else "관리자", password_hash=hash_password(password), is_admin=admin,
                    email_verified_at=datetime.now(timezone.utc), **more)
        s.add(user)
        s.commit()
        return user


def bearer(signer, user, version=0):
    return {"Authorization": f"Bearer {signer.issue(str(user.id), version)}"}


def test_addresses_and_names_are_masked_in_the_list():
    assert mask_email("lee.joo@example.com") == "le*****@example.com"
    assert mask_email("a@b.kr") == "a*@b.kr"
    assert mask_name("이주형") == "이**"


def test_only_an_admin_reads_the_console_and_nothing_is_cached(world):
    client, _, make, signer = world
    member, admin = person(make, "lee@example.com"), person(make, "op@example.com", admin=True)
    assert client.get("/api/admin/overview").status_code == 401
    assert client.get("/api/admin/overview", headers=bearer(signer, member)).status_code == 403
    assert client.post("/api/admin/members/search", json={}, headers=bearer(signer, member)).status_code == 403
    answer = client.get("/api/admin/overview", params={"days": 7}, headers=bearer(signer, admin))
    assert answer.status_code == 200 and answer.headers["cache-control"] == "no-store"
    assert client.get("/api/admin/overview", params={"days": 5}, headers=bearer(signer, admin)).status_code == 422


def test_the_overview_compares_a_period_with_the_one_before(world):
    client, _, make, signer = world
    admin = person(make, "op@example.com", admin=True)
    with make() as s:
        s.add_all([StatsDaily(day=today(), name="visit", count=5), StatsDaily(day=today() - timedelta(days=8), name="visit", count=2),
                   StatsDaily(day=today(), name="recommend:food", count=3), StatsDaily(day=today(), name="recommend:music", count=1),
                   Feedback(kind="idea", message="좋아요"), Report(item_id="f01", category="food", item_name="김치찌개", item_subtitle="", kind="other")])
        s.commit()
    board = client.get("/api/admin/overview", params={"days": 7}, headers=bearer(signer, admin)).json()
    assert board["kpis"]["visit"] == {"current": 5, "previous": 2}
    assert board["kpis"]["recommend"]["current"] == 4 and len(board["series"]) == 7
    assert board["todo"] == {"openReports": 1, "newFeedback": 1, "clientErrorsToday": 0}
    assert {q["key"] for q in board["quotas"]} >= {"ai:total", "yt:all"}


def test_members_are_searched_filtered_sorted_and_paged_with_masked_addresses(world):
    client, _, make, signer = world
    admin = person(make, "op@example.com", admin=True)
    for n in range(7):
        person(make, f"user{n}@example.com", created_at=datetime(2026, 11, 1 + n, tzinfo=timezone.utc))
    person(make, "stopped@example.com", suspended_at=datetime.now(timezone.utc), suspended_reason="스팸")
    page = client.post("/api/admin/members/search", json={"size": 5, "sort": "created", "order": "asc"}, headers=bearer(signer, admin)).json()
    assert page["total"] == 9 and len(page["members"]) == 5 and page["members"][0]["email"] == "us***@example.com"
    assert all("@example.com" in m["email"] and "*" in m["email"] for m in page["members"])
    found = client.post("/api/admin/members/search", json={"q": "user3"}, headers=bearer(signer, admin)).json()
    assert found["total"] == 1
    assert client.post("/api/admin/members/search", json={"q": "%"}, headers=bearer(signer, admin)).json()["total"] == 0  # a wildcard is a character
    suspended = client.post("/api/admin/members/search", json={"filter": "suspended"}, headers=bearer(signer, admin)).json()
    assert suspended["total"] == 1 and suspended["members"][0]["suspended"]


def test_a_members_details_are_whole_counted_not_shown_and_the_look_is_recorded(world):
    client, _, make, signer = world
    admin = person(make, "op@example.com", admin=True)
    member = person(make, "lee@example.com", store={"version": 2, "name": "x", "favorites": ["f01", "f02"], "history": [{"id": 1}],
                                                     "profiles": {"food": {"selected": ["f01"], "tags": [], "disliked": []}}, "health": {"agreedAt": "x"}})
    details = client.get(f"/api/admin/members/{member.id}", headers=bearer(signer, admin)).json()
    assert details["email"] == "lee@example.com" and details["name"] == "이주형"
    assert details["store"]["counts"] == {"favorites": 2, "history": 1, "liked": 1, "tasteTypes": 0}
    assert "health" not in str(details["store"]) and "f01" not in str(details)
    with make() as s:
        seen = s.scalars(select(AdminAudit)).all()
    assert [(a.action, a.target_id, a.actor_email) for a in seen] == [("view_member", str(member.id), "op@example.com")]
    assert client.get(f"/api/admin/members/{uuid.uuid4()}", headers=bearer(signer, admin)).status_code == 404


def test_a_suspended_account_is_signed_out_and_kept_out_at_every_door(world):
    client, outbox, make, signer = world
    admin = person(make, "op@example.com", admin=True)
    member = person(make, "lee@example.com")
    assert client.get("/api/auth/me", headers=bearer(signer, member)).status_code == 200
    stopped = client.post(f"/api/admin/members/{member.id}/suspend", json={"reason": "같은 신고를 반복해서 보냄"}, headers=bearer(signer, admin))
    assert stopped.status_code == 200 and stopped.json()["suspended"] and stopped.json()["mailed"]
    assert outbox.sent[-1][0] == "lee@example.com" and "같은 신고를 반복해서 보냄" in outbox.sent[-1][2]
    # The old token, a fresh one for the right version, the login, and a reset: none lets the account in.
    assert client.get("/api/auth/me", headers=bearer(signer, member)).status_code == 401
    assert client.get("/api/auth/me", headers=bearer(signer, member, 1)).status_code == 401
    login = client.post("/api/auth/login", json={"email": "lee@example.com", "password": "password1"})
    assert login.status_code == 403 and "제한" in login.json()["detail"]
    assert client.post("/api/auth/login", json={"email": "lee@example.com", "password": "wrong-one"}).status_code == 401  # wrong password: no hint
    sent = len(outbox.sent)
    assert client.post("/api/auth/reset/request", json={"email": "lee@example.com"}).status_code == 202 and len(outbox.sent) == sent
    with make() as s:
        user = s.get(User, member.id)
        link = signer.issue_reset(str(user.id), user.password_hash, 600)
    assert client.post("/api/auth/reset/confirm", json={"token": link, "password": "password2"}).status_code == 403
    # Released: the person signs in again with the password.
    assert client.post(f"/api/admin/members/{member.id}/unsuspend", json={"reason": "이의 받아들임"}, headers=bearer(signer, admin)).status_code == 200
    assert client.post("/api/auth/login", json={"email": "lee@example.com", "password": "password1"}).status_code == 200
    with make() as s:
        assert [a.action for a in s.scalars(select(AdminAudit).order_by(AdminAudit.id))] == ["suspend", "unsuspend"]


def test_no_admin_suspends_itself_or_another_admin_and_a_reason_is_required(world):
    client, _, make, signer = world
    admin, other = person(make, "op@example.com", admin=True), person(make, "op2@example.com", admin=True)
    member = person(make, "lee@example.com")
    assert client.post(f"/api/admin/members/{admin.id}/suspend", json={"reason": "시험"}, headers=bearer(signer, admin)).status_code == 409
    assert client.post(f"/api/admin/members/{other.id}/suspend", json={"reason": "시험"}, headers=bearer(signer, admin)).status_code == 409
    assert client.post(f"/api/admin/members/{member.id}/suspend", json={"reason": " "}, headers=bearer(signer, admin)).status_code == 422
    assert client.post(f"/api/admin/members/{member.id}/suspend", json={"reason": "스팸", "notify": False}, headers=bearer(signer, admin)).json()["mailed"] is False
    assert client.post(f"/api/admin/members/{member.id}/suspend", json={"reason": "스팸"}, headers=bearer(signer, admin)).status_code == 409


def test_signing_a_member_out_everywhere_ends_its_tokens(world):
    client, _, make, signer = world
    admin, member = person(make, "op@example.com", admin=True), person(make, "lee@example.com")
    assert client.post(f"/api/admin/members/{member.id}/signout", json={"reason": "휴대폰 분실 문의"}, headers=bearer(signer, admin)).status_code == 200
    assert client.get("/api/auth/me", headers=bearer(signer, member)).status_code == 401
    assert client.get("/api/auth/me", headers=bearer(signer, member, 1)).status_code == 200
    assert client.post(f"/api/admin/members/{admin.id}/signout", json={}, headers=bearer(signer, admin)).status_code == 409


def test_feedback_is_settled_noted_filtered_and_recorded(world):
    client, _, make, signer = world
    admin = person(make, "op@example.com", admin=True)
    client.post("/api/feedback", json={"kind": "idea", "message": "다크 모드가 좋아요"})
    client.post("/api/feedback", json={"kind": "problem", "message": "버튼이 안 눌려요"})
    listed = client.get("/api/admin/feedback", params={"status": "new"}, headers=bearer(signer, admin)).json()
    assert listed["counts"] == {"new": 2, "done": 0} and all(f["status"] == "new" for f in listed["feedback"])
    target = next(f for f in listed["feedback"] if f["kind"] == "problem")
    done = client.post(f"/api/admin/feedback/{target['id']}", json={"status": "done", "note": "1.4에서 고침"}, headers=bearer(signer, admin)).json()
    assert done["status"] == "done" and done["handledAt"] and done["note"] == "1.4에서 고침"
    assert [f["kind"] for f in client.get("/api/admin/feedback", params={"status": "new"}, headers=bearer(signer, admin)).json()["feedback"]] == ["idea"]
    assert [f["kind"] for f in client.get("/api/admin/feedback", params={"kind": "problem"}, headers=bearer(signer, admin)).json()["feedback"]] == ["problem"]
    again = client.post(f"/api/admin/feedback/{target['id']}", json={"status": "new"}, headers=bearer(signer, admin)).json()
    assert again["status"] == "new" and again["handledAt"] is None
    client.delete(f"/api/admin/feedback/{target['id']}", headers=bearer(signer, admin))
    record = client.get("/api/admin/audit", headers=bearer(signer, admin)).json()["entries"]
    assert [e["action"] for e in record] == ["feedback_delete", "feedback_new", "feedback_note", "feedback_done"]
    assert [e["action"] for e in client.get("/api/admin/audit", params={"action": "feedback_note"}, headers=bearer(signer, admin)).json()["entries"]] == ["feedback_note"]


def test_one_address_opens_its_thirty_days_and_the_look_is_recorded(world):
    client, _, make, signer = world
    admin = person(make, "op@example.com", admin=True)
    now = datetime.now(timezone.utc)
    with make() as s:
        s.add_all([AccessLog(address="203.0.113.5", event="visit", at=now - timedelta(days=1)), AccessLog(address="203.0.113.5", event="login", at=now),
                   AccessLog(address="203.0.113.5", event="visit", at=now - timedelta(days=40)), AccessLog(address="198.51.100.2", event="visit", at=now)])
        s.commit()
    history = client.post("/api/admin/access/address", json={"address": "203.0.113.5"}, headers=bearer(signer, admin)).json()
    assert history["total"] == 2 and history["events"] == {"visit": 1, "login": 1} and len(history["days"]) == 2
    narrowed = client.post("/api/admin/access/search", json={"address": "203.0.113", "event": "login"}, headers=bearer(signer, admin)).json()
    assert [e["address"] for e in narrowed["entries"]] == ["203.0.113.5"]
    assert client.post("/api/admin/access/search", json={"event": "visit"}, headers=bearer(signer, admin)).status_code == 200  # no address: not a look at one place
    with make() as s:
        assert [(a.action, a.target_id) for a in s.scalars(select(AdminAudit).order_by(AdminAudit.id))] == [("view_address", "203.0.113.5"), ("view_address", "203.0.113")]


def test_the_suspension_notice_names_the_reason_and_where_to_object():
    subject, text, html = suspend_mail("광고 글 반복 <b>", "https://app.example.com/#/terms")
    assert "이용 제한" in subject and "광고 글 반복 <b>" in text and "&lt;b&gt;" in html and "https://app.example.com/#/terms" in text


class BrokenMail(Outbox):
    def send(self, to, subject, text, html=None):
        raise ConnectionRefusedError("no mail server")


def test_a_failed_notice_leaves_the_suspension_in_place_and_says_so(world):
    client, _, make, signer = world
    client.app.dependency_overrides[get_mailer] = lambda: BrokenMail()
    admin, member = person(make, "op@example.com", admin=True), person(make, "lee@example.com")
    answer = client.post(f"/api/admin/members/{member.id}/suspend", json={"reason": "광고 반복"}, headers=bearer(signer, admin)).json()
    assert answer["suspended"] and answer["mailed"] is False
    with make() as s:
        assert s.scalar(select(AdminAudit.detail)) == {"notified": False, "who": "le*@example.com"}


def test_a_release_ends_the_tokens_issued_before_the_suspension(world):
    client, _, make, signer = world
    admin, member = person(make, "op@example.com", admin=True), person(make, "lee@example.com")
    client.post(f"/api/admin/members/{member.id}/suspend", json={"reason": "확인 중", "notify": False}, headers=bearer(signer, admin))
    client.post(f"/api/admin/members/{member.id}/unsuspend", json={}, headers=bearer(signer, admin))
    assert client.get("/api/auth/me", headers=bearer(signer, member, 1)).status_code == 401  # minted between the two
    assert client.get("/api/auth/me", headers=bearer(signer, member, 2)).status_code == 200


def test_a_suspended_unconfirmed_sign_up_is_not_swept_away(world):
    from app.retention import sweep
    client, _, make, signer = world
    old = datetime.now(timezone.utc) - timedelta(days=30)
    with make() as s:
        s.add_all([User(email="gone@example.com", name="a", password_hash="x", created_at=old),
                   User(email="held@example.com", name="b", password_hash="x", created_at=old, suspended_at=old, suspended_reason="스팸")])
        s.commit()
        sweep(s, settings())
        assert [u.email for u in s.scalars(select(User))] == ["held@example.com"]


def test_odd_saved_data_still_opens_the_member(world):
    client, _, make, signer = world
    admin = person(make, "op@example.com", admin=True)
    member = person(make, "lee@example.com", store={"version": 2, "favorites": "x", "profiles": {"food": {"selected": 3}, "music": "y"}, "tasteTypes": []})
    details = client.get(f"/api/admin/members/{member.id}", headers=bearer(signer, admin))
    assert details.status_code == 200 and details.json()["store"]["counts"] == {"liked": 0, "tasteTypes": 0}

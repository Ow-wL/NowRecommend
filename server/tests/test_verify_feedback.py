"""Confirming a new account's address by mail, and 의견 보내기 (2026-11-18). The routes run on SQLite (users, feedback and
the daily counters), with a mailer that only remembers what it was asked to send."""
import re
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import TokenSigner
from app.config import Settings, get_settings
from app.db import get_session
from app.mail import get_mailer, verify_mail
from app.main import create_app
from app.models import Feedback, UsageDaily, User
from app.retention import sweep
from app.routes.auth import get_signer

APP_URL = "https://app.example.com/now/"
SIGNUP = {"email": "lee@example.com", "password": "password1", "name": "주형"}
RIGHT = {"email": "lee@example.com", "password": "password1"}


class Outbox:
    def __init__(self):
        self.sent = []

    def send(self, to, subject, text, html=None):
        self.sent.append({"to": to, "subject": subject, "text": text, "html": html})

    def token(self, kind="verify"):
        link = re.search(r"https://\S+", self.sent[-1]["text"]).group(0)
        assert link.startswith(f"{APP_URL}#/{kind}/")
        return link.rsplit("/", 1)[1]


def settings(**more):
    return Settings(public_app_url=APP_URL, auth_secret="test-secret", signup_daily_per_address=0, email_verification=True, **more)


@pytest.fixture
def world():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for table in (User, UsageDaily, Feedback):
        table.__table__.create(engine)
    make = sessionmaker(engine, expire_on_commit=False)

    def session():
        with make() as s:
            yield s

    outbox = Outbox()
    signer = TokenSigner("test-secret", ttl_seconds=3600)
    app = create_app()
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[get_signer] = lambda: signer
    app.dependency_overrides[get_mailer] = lambda: outbox
    app.dependency_overrides[get_settings] = lambda: settings()
    with TestClient(app) as client:
        yield client, outbox, app, make, signer


def test_a_new_account_signs_in_only_after_its_address_is_confirmed(world):
    client, outbox, *_ = world
    made = client.post("/api/auth/signup", json=SIGNUP)
    assert made.status_code == 202 and made.json() == {"verify": "sent", "email": "lee@example.com"}
    assert "token" not in made.json() and [m["to"] for m in outbox.sent] == ["lee@example.com"]
    assert "이메일 주소를 확인" in outbox.sent[0]["subject"]
    refused = client.post("/api/auth/login", json=RIGHT)
    assert refused.status_code == 403 and "확인 메일을 보냈어요" in refused.json()["detail"]
    assert len(outbox.sent) == 2  # the right password mails the link again
    assert client.post("/api/auth/login", json={**RIGHT, "password": "wrong-pass"}).status_code == 401  # a wrong one learns nothing
    token = outbox.token()
    assert client.post("/api/auth/verify", json={"token": token}).json() == {"verified": True, "email": "lee@example.com"}
    assert client.post("/api/auth/verify", json={"token": token}).status_code == 200  # opened again: still confirmed
    signed = client.post("/api/auth/login", json=RIGHT)
    assert signed.status_code == 200 and signed.json()["token"]


def test_an_older_link_works_too_but_not_after_the_password_changed(world):
    client, outbox, app, make, signer = world
    client.post("/api/auth/signup", json=SIGNUP)
    first = outbox.token()
    client.post("/api/auth/login", json=RIGHT)
    assert len(outbox.sent) == 2
    with make() as s:  # the password is set anew (by a reset link, say) before the mailed link is opened
        s.execute(update(User).values(password_hash="pbkdf2_sha256$1$AAAA$BBBB"))
        s.commit()
    assert client.post("/api/auth/verify", json={"token": first}).status_code == 400


def test_a_link_is_good_only_for_its_purpose(world):
    client, outbox, app, make, signer = world
    client.post("/api/auth/signup", json=SIGNUP)
    token = outbox.token()
    assert signer.session(token) is None and signer.reset(token) is None  # not a session, not a reset
    with make() as s:
        user = s.scalar(select(User))
        reset = signer.issue_reset(str(user.id), user.password_hash)
        session_token = signer.issue(str(user.id))
    for wrong in (reset, session_token, token[:-2] + "xx", "x" * 30):
        assert client.post("/api/auth/verify", json={"token": wrong}).status_code == 400


def test_the_same_address_is_not_taken_over_by_signing_up_again(world):
    client, outbox, app, make, _ = world
    client.post("/api/auth/signup", json=SIGNUP)
    again = client.post("/api/auth/signup", json={**SIGNUP, "password": "another-pass", "name": "남"})
    assert again.status_code == 409 and "비밀번호 재설정" in again.json()["detail"]
    with make() as s:
        user = s.scalar(select(User))
        assert user.name == "주형" and len(outbox.sent) == 1


def test_a_reset_link_confirms_the_address_and_hands_the_account_to_the_inbox(world):
    """Someone signed up with lee's address first. lee's reset link sets lee's own password and confirms the address."""
    client, outbox, app, make, _ = world
    client.post("/api/auth/signup", json={**SIGNUP, "password": "squatter-pw"})
    assert client.post("/api/auth/reset/request", json={"email": "lee@example.com"}).status_code == 202
    done = client.post("/api/auth/reset/confirm", json={"token": outbox.token("reset"), "password": "password1"})
    assert done.status_code == 200 and done.json()["token"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {done.json()['token']}"}).status_code == 200
    assert client.post("/api/auth/login", json=RIGHT).status_code == 200


def test_an_account_from_before_confirmation_loses_its_session_until_confirmed(world):
    client, outbox, app, make, signer = world
    app.dependency_overrides[get_settings] = lambda: Settings(public_app_url=APP_URL, auth_secret="test-secret", signup_daily_per_address=0)
    token = client.post("/api/auth/signup", json=SIGNUP).json()["token"]  # made with confirmation off
    auth = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/auth/me", headers=auth).status_code == 200
    app.dependency_overrides[get_settings] = lambda: settings()
    assert client.get("/api/auth/me", headers=auth).status_code == 401
    assert client.post("/api/auth/signup", json=SIGNUP).json()["detail"] == "이미 가입된 이메일이에요. 로그인해주세요."
    assert client.post("/api/auth/login", json=RIGHT).status_code == 403
    assert client.post("/api/auth/verify", json={"token": outbox.token()}).status_code == 200
    assert client.get("/api/auth/me", headers=auth).status_code == 200  # the token it had works again
    assert client.post("/api/auth/login", json=RIGHT).status_code == 200


def test_confirmation_mails_are_counted_per_inbox_and_for_the_service(world):
    client, outbox, app, *_ = world
    app.dependency_overrides[get_settings] = lambda: settings(verify_daily_per_email=2, verify_daily_total=3)
    client.post("/api/auth/signup", json=SIGNUP)
    answers = [client.post("/api/auth/login", json=RIGHT).json()["detail"] for _ in range(2)]
    assert len(outbox.sent) == 2 and "더 보낼 수 없어요" in answers[-1]
    client.post("/api/auth/signup", json={**SIGNUP, "email": "kim@example.com"})
    made = client.post("/api/auth/signup", json={**SIGNUP, "email": "park@example.com"})
    assert made.status_code == 202 and made.json()["verify"] == "failed"  # the service's three are used
    assert [m["to"] for m in outbox.sent] == ["lee@example.com", "lee@example.com", "kim@example.com"]


def test_sign_up_needs_a_mailer_when_confirmation_is_on(world):
    client, _, app, make, _ = world
    app.dependency_overrides[get_mailer] = lambda: None
    assert client.post("/api/auth/signup", json=SIGNUP).status_code == 503
    with make() as s:
        assert s.scalar(select(User)) is None


def test_unconfirmed_sign_ups_go_after_their_days_and_nothing_else_does(world):
    client, outbox, app, make, _ = world
    client.post("/api/auth/signup", json=SIGNUP)
    app.dependency_overrides[get_settings] = lambda: Settings(public_app_url=APP_URL, auth_secret="test-secret", signup_daily_per_address=0)
    client.post("/api/auth/signup", json={**SIGNUP, "email": "old@example.com"})  # from before: signed in once
    long_ago = datetime.now(timezone.utc) - timedelta(days=30)
    with make() as s:
        s.execute(update(User).values(created_at=long_ago))
        s.add(Feedback(kind="idea", message="오래된 의견", created_at=datetime.now(timezone.utc) - timedelta(days=400)))
        s.add(Feedback(kind="idea", message="새 의견"))
        s.commit()
        assert sweep(s, settings()) == (1, 1)
        assert [u.email for u in s.scalars(select(User))] == ["old@example.com"]
        assert [f.message for f in s.scalars(select(Feedback))] == ["새 의견"]


def test_an_expired_unconfirmed_sign_up_frees_its_address(world):
    client, outbox, app, make, _ = world
    client.post("/api/auth/signup", json=SIGNUP)
    with make() as s:
        s.execute(update(User).values(created_at=datetime.now(timezone.utc) - timedelta(days=9)))
        s.commit()
    assert client.post("/api/auth/login", json=RIGHT).json()["detail"].endswith("내일 다시 시도해주세요.")  # no new link for it
    again = client.post("/api/auth/signup", json={**SIGNUP, "name": "새 이름"})
    assert again.status_code == 202
    with make() as s:
        assert [u.name for u in s.scalars(select(User))] == ["새 이름"]


def test_the_confirmation_mail_names_the_link_and_the_hours():
    subject, text, html = verify_mail("주형", "https://nowrec.kr/#/verify/abc<", 24)
    assert "https://nowrec.kr/#/verify/abc<" in text and "24시간" in text
    assert "abc&lt;" in html and "abc<" not in html


# ---- 의견 보내기 ----

def test_feedback_is_kept_without_the_account_and_an_admin_reads_it(world):
    client, outbox, app, make, signer = world
    sent = client.post("/api/feedback", json={"kind": "idea", "message": "  다크 모드도 있으면 좋겠어요  ", "contact": " Lee@Example.com ",
                                              "page": "settings", "appVersion": "2026.11.18"})
    assert sent.status_code == 201
    assert client.post("/api/feedback", json={"kind": "praise", "message": "좋아요"}).status_code == 201
    for wrong in ({"kind": "spam", "message": "x"}, {"kind": "idea", "message": "   "}, {"kind": "idea", "message": "x" * 1001},
                  {"kind": "idea", "message": "x", "contact": "not-an-address"}, {"kind": "idea", "message": "x", "page": "reset/abc.def"}):
        assert client.post("/api/feedback", json=wrong).status_code == 422
    assert client.get("/api/admin/feedback").status_code == 401
    with make() as s:
        s.add(User(email="admin@example.com", name="관리자", password_hash="x", is_admin=True, email_verified_at=datetime.now(timezone.utc)))
        s.add(User(email="member@example.com", name="회원", password_hash="x", email_verified_at=datetime.now(timezone.utc)))
        s.commit()
        admin, member = (s.scalar(select(User).where(User.email == e)) for e in ("admin@example.com", "member@example.com"))
    assert client.get("/api/admin/feedback", headers={"Authorization": f"Bearer {signer.issue(str(member.id))}"}).status_code == 403
    auth = {"Authorization": f"Bearer {signer.issue(str(admin.id))}"}
    listed = client.get("/api/admin/feedback", headers=auth).json()
    said = {f["message"]: f for f in listed["feedback"]}
    assert sorted(said) == ["다크 모드도 있으면 좋겠어요", "좋아요"] and listed["more"] is False
    assert said["다크 모드도 있으면 좋겠어요"]["contact"] == "lee@example.com" and said["좋아요"]["contact"] is None
    assert said["다크 모드도 있으면 좋겠어요"]["page"] == "settings" and said["좋아요"]["page"] == ""
    assert client.delete(f"/api/admin/feedback/{said['좋아요']['id']}", headers=auth).status_code == 204
    assert [f["message"] for f in client.get("/api/admin/feedback", headers=auth).json()["feedback"]] == ["다크 모드도 있으면 좋겠어요"]


def test_feedback_is_counted_per_place_and_for_the_service(world):
    client, _, app, *_ = world
    app.dependency_overrides[get_settings] = lambda: settings(feedback_daily_per_address=2, feedback_daily_total=3)
    one = {"kind": "other", "message": "하나"}
    assert [client.post("/api/feedback", json=one).status_code for _ in range(3)] == [201, 201, 429]
    app.dependency_overrides[get_settings] = lambda: settings(feedback_daily_per_address=0, feedback_daily_total=3)
    assert [client.post("/api/feedback", json=one).status_code for _ in range(2)] == [201, 429]  # the service's three: two before, one now


def test_admin_pages_through_feedback_sent_in_the_same_instant_without_skipping(world):
    client, _, app, make, signer = world
    same = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)
    with make() as s:
        for n in range(53):
            s.add(Feedback(kind="idea", message=f"의견 {n}", created_at=same))
        s.add(User(email="admin@example.com", name="관리자", password_hash="x", is_admin=True, email_verified_at=same))
        s.commit()
        admin = s.scalar(select(User))
    auth = {"Authorization": f"Bearer {signer.issue(str(admin.id))}"}
    first = client.get("/api/admin/feedback", headers=auth).json()
    last = first["feedback"][-1]
    rest = client.get("/api/admin/feedback", headers=auth, params={"before": last["createdAt"], "beforeId": last["id"]}).json()
    assert first["more"] is True and rest["more"] is False
    assert len({f["id"] for f in first["feedback"] + rest["feedback"]}) == 53


def test_the_daily_removal_keeps_admins_and_accounts_holding_data(world):
    client, outbox, app, make, _ = world
    for email in ("a@example.com", "b@example.com", "c@example.com"):
        client.post("/api/auth/signup", json={**SIGNUP, "email": email})
    with make() as s:
        s.execute(update(User).values(created_at=datetime.now(timezone.utc) - timedelta(days=30)))
        s.execute(update(User).where(User.email == "a@example.com").values(is_admin=True))
        s.execute(update(User).where(User.email == "b@example.com").values(store={"version": 2}))
        s.commit()
        assert sweep(s, settings()) == (1, 0)
        assert sorted(u.email for u in s.scalars(select(User))) == ["a@example.com", "b@example.com"]

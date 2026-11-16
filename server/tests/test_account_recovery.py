"""Passwords and sessions (2026-11-17): changing a password, resetting a forgotten one by mail, signing out everywhere.
The routes run on SQLite (users + the daily counters), with a mailer that only remembers what it was asked to send."""
import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import mail
from app.auth import TokenSigner
from app.config import Settings, get_settings
from app.db import get_session
from app.mail import SmtpMailer, get_mailer, reset_mail
from app.main import create_app
from app.models import UsageDaily, User
from app.routes.auth import get_signer

SIGNUP = {"email": "lee@example.com", "password": "password1", "name": "주형"}
APP_URL = "https://app.example.com/now/"


class Outbox:
    def __init__(self, fails=False):
        self.sent, self.fails = [], fails

    def send(self, to, subject, text, html=None):
        if self.fails:
            raise OSError("smtp is down")
        self.sent.append({"to": to, "subject": subject, "text": text, "html": html})

    def link_token(self):
        link = re.search(r"https://\S+", self.sent[-1]["text"]).group(0)
        assert link.startswith(f"{APP_URL}#/reset/")
        return link.rsplit("/", 1)[1]


class Clock:
    now = 1_800_000_000.0

    def __call__(self):
        return self.now


@pytest.fixture
def world():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    User.__table__.create(engine)
    UsageDaily.__table__.create(engine)
    make = sessionmaker(engine, expire_on_commit=False)

    def session():
        with make() as s:
            yield s

    clock, outbox = Clock(), Outbox()
    signer = TokenSigner("test-secret", ttl_seconds=3600, now=clock)
    app = create_app()
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[get_signer] = lambda: signer
    app.dependency_overrides[get_mailer] = lambda: outbox
    app.dependency_overrides[get_settings] = lambda: Settings(public_app_url=APP_URL, reset_daily_per_address=5, reset_daily_per_email=2,
                                                              signup_daily_per_address=0, auth_secret="test-secret")
    with TestClient(app) as client:
        token = client.post("/api/auth/signup", json=SIGNUP).json()["token"]
        yield client, {"Authorization": f"Bearer {token}"}, outbox, clock, signer, app


def test_tokens_are_two_kinds_and_old_ones_count_as_version_zero():
    clock = Clock()
    signer = TokenSigner("secret", ttl_seconds=60, now=clock)
    assert signer.session(signer.issue("u1", 3)) == ("u1", 3) and signer.verify(signer.issue("u1", 3)) == "u1"
    # A token issued before versions existed: no number, read as 0.
    old = signer._token({"sub": "u1", "exp": int(clock.now) + 60})
    assert signer.session(old) == ("u1", 0)
    reset = signer.issue_reset("u1", "pbkdf2$hash", ttl_seconds=30)
    assert signer.reset(reset) == ("u1", signer.fingerprint("pbkdf2$hash"))
    # Neither kind passes for the other, and the fingerprint is not the hash.
    assert signer.session(reset) is None and signer.verify(reset) is None and signer.reset(signer.issue("u1", 0)) is None
    assert "pbkdf2" not in reset and signer.fingerprint("pbkdf2$hash") != signer.fingerprint("pbkdf2$other")
    assert signer.fingerprint("pbkdf2$hash") != TokenSigner("other").fingerprint("pbkdf2$hash")
    # A reset token is signed with its own key: code that checks only the signature with the secret itself (every API
    # revision from before 2026-11-17) cannot take it for a session.
    payload, signature = reset.split(".")
    assert signature != signer._sign(payload) and signature == signer._sign(payload, "reset")
    forged = signer._token({"sub": "u1", "use": "reset", "pw": signer.fingerprint("pbkdf2$hash"), "exp": int(clock.now) + 60})  # signed as a session
    assert signer.reset(forged) is None
    clock.now += 31
    assert signer.reset(reset) is None
    assert signer.reset("garbage") is None and signer.session("a.b") is None


def test_a_new_password_ends_the_other_sessions_and_keeps_this_one(world):
    client, auth, *_ = world
    other = {"Authorization": f"Bearer {client.post('/api/auth/login', json=SIGNUP).json()['token']}"}  # the same account on a phone
    assert client.post("/api/auth/password", json={"currentPassword": "wrong-pass", "newPassword": "password2"}, headers=auth).status_code == 403  # not 401: the session is fine
    assert client.get("/api/auth/me", headers=other).status_code == 200  # a wrong guess changes nothing
    assert client.post("/api/auth/password", json={"currentPassword": "password1", "newPassword": "short"}, headers=auth).status_code == 422
    assert client.post("/api/auth/password", json={"currentPassword": "password1", "newPassword": "password2"}).status_code == 401

    changed = client.post("/api/auth/password", json={"currentPassword": "password1", "newPassword": "password2"}, headers=auth)
    assert changed.status_code == 200 and changed.json()["user"]["email"] == "lee@example.com"
    fresh = {"Authorization": f"Bearer {changed.json()['token']}"}
    assert client.get("/api/auth/me", headers=fresh).status_code == 200
    assert client.get("/api/auth/me", headers=auth).status_code == 401 and client.get("/api/auth/me", headers=other).status_code == 401
    assert client.put("/api/me/store", json={"store": {}}, headers=other).status_code == 401  # nor can an ended session write
    assert client.post("/api/auth/login", json=SIGNUP).status_code == 401
    assert client.post("/api/auth/login", json={**SIGNUP, "password": "password2"}).status_code == 200


def test_signing_out_everywhere_ends_every_token_and_a_new_login_works(world):
    client, auth, *_ = world
    other = {"Authorization": f"Bearer {client.post('/api/auth/login', json=SIGNUP).json()['token']}"}
    assert client.post("/api/auth/logout-all").status_code == 401
    assert client.post("/api/auth/logout-all", headers=auth).status_code == 204
    assert client.get("/api/auth/me", headers=auth).status_code == 401 and client.get("/api/auth/me", headers=other).status_code == 401
    again = client.post("/api/auth/login", json=SIGNUP).json()["token"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {again}"}).status_code == 200


def test_a_forgotten_password_is_reset_from_the_mailed_link_once(world):
    client, auth, outbox, *_ = world
    asked = client.post("/api/auth/reset/request", json={"email": " Lee@Example.com "})
    assert asked.status_code == 202 and asked.json() == {"sent": True}
    [mail_out] = outbox.sent
    assert mail_out["to"] == "lee@example.com" and "비밀번호 재설정" in mail_out["subject"] and "30분" in mail_out["text"] and "주형" in mail_out["text"]
    token = outbox.link_token()
    assert token in mail_out["html"]

    assert client.post("/api/auth/reset/confirm", json={"token": token, "password": "short"}).status_code == 422
    done = client.post("/api/auth/reset/confirm", json={"token": token, "password": "new-password"})
    assert done.status_code == 200 and done.json()["user"]["email"] == "lee@example.com"
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {done.json()['token']}"}).status_code == 200  # signed in here
    assert client.get("/api/auth/me", headers=auth).status_code == 401                                               # and out everywhere else
    assert client.post("/api/auth/login", json={**SIGNUP, "password": "new-password"}).status_code == 200
    # The link named the old password, which is gone: it does not work twice.
    again = client.post("/api/auth/reset/confirm", json={"token": token, "password": "another-pass"})
    assert again.status_code == 400 and "다시 요청" in again.json()["detail"]
    assert client.post("/api/auth/login", json={**SIGNUP, "password": "another-pass"}).status_code == 401


def test_the_answer_does_not_tell_whether_an_address_has_an_account(world):
    client, _, outbox, *_ = world
    known = client.post("/api/auth/reset/request", json={"email": "lee@example.com"})
    unknown = client.post("/api/auth/reset/request", json={"email": "nobody@example.com"})
    assert (known.status_code, known.json()) == (unknown.status_code, unknown.json()) == (202, {"sent": True})
    assert [m["to"] for m in outbox.sent] == ["lee@example.com"]
    assert client.post("/api/auth/reset/request", json={"email": "not-an-address"}).status_code == 422


def test_links_expire_and_other_tokens_are_not_links(world):
    client, auth, outbox, clock, signer, _ = world
    client.post("/api/auth/reset/request", json={"email": "lee@example.com"})
    token = outbox.link_token()
    session_token = auth["Authorization"].split(" ")[1]
    for bad in (session_token, token[:-2] + "xx", "x" * 40, TokenSigner("other-secret", now=clock).issue_reset("id", "hash")):
        assert client.post("/api/auth/reset/confirm", json={"token": bad, "password": "new-password"}).status_code == 400
    clock.now += 30 * 60 + 1
    assert client.post("/api/auth/reset/confirm", json={"token": token, "password": "new-password"}).status_code == 400
    assert client.post("/api/auth/login", json=SIGNUP).status_code == 200  # nothing changed


def test_a_password_changed_after_the_mail_was_sent_kills_the_link(world):
    client, auth, outbox, *_ = world
    client.post("/api/auth/reset/request", json={"email": "lee@example.com"})
    token = outbox.link_token()
    client.post("/api/auth/password", json={"currentPassword": "password1", "newPassword": "password2"}, headers=auth)
    assert client.post("/api/auth/reset/confirm", json={"token": token, "password": "attacker-pw"}).status_code == 400


def test_reset_mails_are_limited_per_account_and_per_address(world):
    client, _, outbox, *_ = world
    client.post("/api/auth/signup", json={**SIGNUP, "email": "kim@example.com"})
    codes = [client.post("/api/auth/reset/request", json={"email": "lee@example.com"}).status_code for _ in range(3)]
    assert codes == [202, 202, 202] and len(outbox.sent) == 2  # the third is answered the same, but not mailed
    assert client.post("/api/auth/reset/request", json={"email": "kim@example.com"}).status_code == 202 and len(outbox.sent) == 3
    assert client.post("/api/auth/reset/request", json={"email": "nobody@example.com"}).status_code == 202   # the fifth from this address
    assert client.post("/api/auth/reset/request", json={"email": "kim@example.com"}).status_code == 429
    assert len(outbox.sent) == 3


def test_without_a_mailer_the_reset_is_off_and_a_failed_mail_reads_like_a_sent_one(world):
    client, _, outbox, _, _, app = world
    outbox.fails = True
    assert client.post("/api/auth/reset/request", json={"email": "lee@example.com"}).status_code == 202
    app.dependency_overrides[get_mailer] = lambda: None
    off = client.post("/api/auth/reset/request", json={"email": "lee@example.com"})
    assert off.status_code == 503 and "메일" in off.json()["detail"]


# ---- the SMTP sender ----

class FakeSmtp:
    made = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port, self.steps, self.tls_from_start = host, port, [], context is not None
        FakeSmtp.made.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.steps.append("quit")

    def starttls(self, context=None):
        self.steps.append("starttls")

    def login(self, user, password):
        self.steps.append(("login", user, password))

    def send_message(self, message):
        self.steps.append("send")
        self.message = message


def test_smtp_upgrades_before_the_password_and_sends_text_and_html(monkeypatch):
    FakeSmtp.made.clear()
    monkeypatch.setattr(mail.smtplib, "SMTP", FakeSmtp)
    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", FakeSmtp)
    SmtpMailer("smtp.example.com", 587, "user", "secret", "지금 추천 <no-reply@example.com>").send("lee@example.com", "제목", "본문", "<p>본문</p>")
    SmtpMailer("smtp.example.com", 465, None, None, "no-reply@example.com").send("lee@example.com", "제목", "본문")
    plain, tls = FakeSmtp.made
    assert plain.steps == ["starttls", ("login", "user", "secret"), "send", "quit"] and not plain.tls_from_start
    assert tls.steps == ["send", "quit"] and tls.tls_from_start  # 465 is TLS already; no account, no login
    message = plain.message
    assert message["To"] == "lee@example.com" and "no-reply@example.com" in message["From"] and message["Subject"] == "제목"
    assert [part.get_content_type() for part in message.iter_parts()] == ["text/plain", "text/html"]
    assert tls.message["From"] == "no-reply@example.com" and not tls.message.is_multipart()


def test_the_reset_mail_escapes_the_name_and_mail_is_off_without_settings(monkeypatch):
    subject, text, html = reset_mail('<b>"주형"</b>', "https://app.example.com/#/reset/abc", 30)
    assert "<b>" in text and "<b>" not in html and "&lt;b&gt;&quot;주형&quot;&lt;/b&gt;" in html and "비밀번호 재설정" in subject
    assert 'href="https://app.example.com/#/reset/abc"' in html
    monkeypatch.setattr(mail, "get_settings", lambda: Settings(smtp_host=None, mail_from=None))
    assert get_mailer() is None
    monkeypatch.setattr(mail, "get_settings", lambda: Settings(smtp_host="smtp.example.com", mail_from=None))
    assert get_mailer() is None  # a sender address is needed too
    monkeypatch.setattr(mail, "get_settings", lambda: Settings(smtp_host="smtp.example.com", mail_from="a@b.co", smtp_port=465))
    assert isinstance(get_mailer(), SmtpMailer) and get_mailer().port == 465


def test_a_password_is_replaced_only_if_it_is_still_the_one_that_was_checked(world):
    """What makes a link single-use when two requests arrive together: the UPDATE names the hash that was checked."""
    from sqlalchemy import select

    from app.routes.auth import _replace_password

    client, auth, _, _, _, app = world
    session = next(app.dependency_overrides[get_session]())
    user = session.scalars(select(User)).one()
    checked = user.password_hash
    assert _replace_password(user, session, checked, "first-winner") == 1       # the version this very UPDATE produced
    assert _replace_password(user, session, checked, "second-loser") is None    # the hash it checked is gone
    assert client.post("/api/auth/login", json={**SIGNUP, "password": "first-winner"}).status_code == 200
    assert client.post("/api/auth/login", json={**SIGNUP, "password": "second-loser"}).status_code == 401
    assert client.get("/api/auth/me", headers=auth).status_code == 401  # and the sessions from before are over


def test_sign_up_needs_each_agreement_for_the_documents_in_force_and_keeps_a_record(world):
    """2026-11-17: the form sends what was agreed to; without all of it there is no account, and with it the account says so."""
    from sqlalchemy import select

    from app.legal import get_legal

    client, _, _, _, _, app = world
    app.dependency_overrides[get_settings] = lambda: Settings(signup_consent_required=True, signup_daily_per_address=0, auth_secret="test-secret")
    version = get_legal().version
    assert get_legal().min_age == 18
    new = {"email": "kim@example.com", "password": "password1", "name": "지은"}
    full = {"termsVersion": version, "agreeTerms": True, "agreePrivacy": True, "adult": True}
    for missing in ("termsVersion", "agreeTerms", "agreePrivacy", "adult"):
        assert client.post("/api/auth/signup", json={**new, **{k: v for k, v in full.items() if k != missing}}).status_code == 422, missing
    assert client.post("/api/auth/signup", json={**new, **full, "adult": False}).status_code == 422
    assert client.post("/api/auth/signup", json={**new, **full, "termsVersion": "<script>"}).status_code == 422
    # Agreed, but to documents that are not the ones in force (an old tab): told to reload, no account made.
    stale = client.post("/api/auth/signup", json={**new, **full, "termsVersion": "2020-01-01"})
    assert stale.status_code == 409 and "새로 고친" in stale.json()["detail"]
    assert client.post("/api/auth/signup", json={**new, **full}).status_code == 201
    session = next(app.dependency_overrides[get_session]())
    kim, lee = (session.scalars(select(User).where(User.email == email)).one() for email in ("kim@example.com", "lee@example.com"))
    assert kim.terms_version == version and kim.terms_agreed_at is not None
    assert lee.terms_version is None and lee.terms_agreed_at is None  # made while consent was not required: no record is invented
    assert client.post("/api/auth/login", json={"email": "lee@example.com", "password": "password1"}).status_code == 200  # and it still signs in


def test_the_request_sentence_is_not_stored_unless_that_is_turned_on(monkeypatch):
    """The privacy policy says the sentence is not kept; that is the default, not a deploy setting someone must remember."""
    monkeypatch.delenv("LOG_RAW_TEXT", raising=False)
    assert Settings(_env_file=None).log_raw_text is False


def test_an_old_weaker_hash_is_redone_at_the_next_login(world):
    """2026-11-17: the round count went up. A hash from before still verifies, and is replaced while the password is at hand."""
    from sqlalchemy import select

    from app import auth

    client, _, _, _, _, app = world
    session = next(app.dependency_overrides[get_session]())
    user = session.scalars(select(User)).one()
    user.password_hash = auth.hash_password("password1", iterations=100)
    session.commit()
    assert auth.needs_rehash(user.password_hash) and not auth.needs_rehash(auth.hash_password("x"))
    assert auth.needs_rehash("not-a-hash") and auth.needs_rehash("pbkdf2_sha256$310000$a$b", iterations=600_000)
    assert client.post("/api/auth/login", json={**SIGNUP, "password": "wrong-pass"}).status_code == 401
    session.refresh(user)
    assert user.password_hash.split("$")[1] == "100"  # a wrong password changes nothing
    assert client.post("/api/auth/login", json=SIGNUP).status_code == 200
    session.refresh(user)
    assert user.password_hash.split("$")[1] == str(auth.PBKDF2_ITERATIONS)
    assert client.post("/api/auth/login", json=SIGNUP).status_code == 200  # and the new hash is the same password


def test_the_default_round_count_is_the_current_recommendation(monkeypatch):
    import importlib

    from app import auth

    monkeypatch.delenv("PBKDF2_ITERATIONS", raising=False)
    try:
        assert importlib.reload(auth).PBKDF2_ITERATIONS == 600_000
    finally:
        monkeypatch.undo()
        importlib.reload(auth)


def test_a_browser_error_becomes_one_log_line(world, caplog):
    client, *_ = world
    report = {"kind": "render", "message": "Cannot read properties of undefined\nFAKE LINE level=ERROR", "stack": "at App (App.tsx:10)\n  at main.tsx:5", "page": "home", "release": "abc1234"}
    with caplog.at_level("WARNING", logger="app.client_errors"):
        assert client.post("/api/client-errors", json=report).status_code == 204
    [line] = [r.getMessage() for r in caplog.records if r.name == "app.client_errors"]
    assert "\n" not in line and "kind=render page=home release=abc1234" in line and "Cannot read properties of undefined | FAKE LINE" in line
    # Only what the form of a report allows: no long text, no made-up page names.
    assert client.post("/api/client-errors", json={**report, "message": "x" * 301}).status_code == 422
    assert client.post("/api/client-errors", json={**report, "page": "../etc"}).status_code == 422
    assert client.post("/api/client-errors", json={**report, "kind": "other"}).status_code == 422

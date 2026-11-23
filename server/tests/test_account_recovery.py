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
from app.models import Feedback, StatsDaily, UsageDaily, User
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
    Feedback.__table__.create(engine)
    StatsDaily.__table__.create(engine)  # the dashboard counts (stats.py)
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


def test_the_round_count_is_the_current_recommendation_and_not_a_setting(monkeypatch):
    import importlib

    from app import auth

    lowered = auth.PBKDF2_ITERATIONS  # what tests/conftest.py set for the suite
    monkeypatch.setenv("PBKDF2_ITERATIONS", "1000")  # an environment cannot weaken it
    try:
        assert importlib.reload(auth).PBKDF2_ITERATIONS == 600_000
    finally:
        auth.PBKDF2_ITERATIONS = lowered


def test_the_rehash_at_login_does_not_bring_back_a_password_changed_in_between(world, monkeypatch):
    """The login checked the old hash; before it saves the stronger one, a reset finishes. The old password must stay dead."""
    from sqlalchemy import select, update

    from app import auth
    from app.routes import auth as routes

    client, _, _, _, _, app = world
    session = next(app.dependency_overrides[get_session]())
    user = session.scalars(select(User)).one()
    session.execute(update(User).where(User.id == user.id).values(password_hash=auth.hash_password("password1", iterations=100)))
    session.commit()
    real = routes.hash_password

    def reset_finishes_first(password, iterations=None):
        other = next(app.dependency_overrides[get_session]())  # another request, another session
        other.execute(update(User).where(User.id == user.id).values(password_hash=real("brand-new-pass")))
        other.commit()
        return real(password, iterations)

    monkeypatch.setattr(routes, "hash_password", reset_finishes_first)
    assert client.post("/api/auth/login", json=SIGNUP).status_code == 401  # the old password, checked a moment too early
    monkeypatch.setattr(routes, "hash_password", real)
    assert client.post("/api/auth/login", json=SIGNUP).status_code == 401
    assert client.post("/api/auth/login", json={**SIGNUP, "password": "brand-new-pass"}).status_code == 200


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
    assert client.post("/api/client-errors", json={**report, "extra": "field"}).status_code == 422
    # A body far larger than any report is refused on its declared length, before it is read.
    assert client.post("/api/client-errors", content=b"x" * 9000, headers={"Content-Type": "application/json"}).status_code == 413


def test_a_login_that_proved_the_old_password_gets_no_token_once_the_password_has_changed(world, monkeypatch):
    """Between "the password is right" and the token, the password is changed elsewhere (and every session ended). The
    login in flight must not come out with a token that outlives that: it proved a password that no longer exists."""
    from sqlalchemy import select, update

    from app.routes import auth as routes

    client, _, _, _, _, app = world
    session = next(app.dependency_overrides[get_session]())
    user = session.scalars(select(User)).one()
    real = routes.verify_password

    def changed_right_after_the_check(password, stored):
        ok = real(password, stored)
        if ok:
            other = next(app.dependency_overrides[get_session]())  # another request: a reset finishing
            other.execute(update(User).where(User.id == user.id).values(password_hash=routes.hash_password("brand-new-pass"), token_version=User.token_version + 1))
            other.commit()
        return ok

    monkeypatch.setattr(routes, "verify_password", changed_right_after_the_check)
    answer = client.post("/api/auth/login", json=SIGNUP)
    assert answer.status_code == 401 and "token" not in answer.json()
    monkeypatch.setattr(routes, "verify_password", real)
    fresh = client.post("/api/auth/login", json={**SIGNUP, "password": "brand-new-pass"})
    assert fresh.status_code == 200
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {fresh.json()['token']}"}).status_code == 200  # the token carries the version it saw


def test_a_failed_mail_is_logged_by_kind_and_never_with_the_address(world, caplog):
    """A mail server's refusal quotes the recipient. The log says what kind of failure it was and nothing more."""
    import smtplib

    client, _, _, _, _, app = world

    class Refusing:
        def send(self, to, subject, text, html=None):
            raise smtplib.SMTPRecipientsRefused({to: (550, f"5.1.1 <{to}>: no such user".encode())})

    app.dependency_overrides[get_mailer] = lambda: Refusing()
    with caplog.at_level("ERROR"):
        assert client.post("/api/auth/reset/request", json={"email": "lee@example.com"}).status_code == 202
    assert "reset mail could not be sent: SMTPRecipientsRefused 550" in caplog.text
    assert "lee@example.com" not in caplog.text and "Traceback" not in caplog.text

    class Rejected:
        def send(self, to, subject, text, html=None):
            raise smtplib.SMTPAuthenticationError(535, b"bad key")

    app.dependency_overrides[get_mailer] = lambda: Rejected()
    caplog.clear()
    with caplog.at_level("ERROR"):
        assert client.post("/api/auth/reset/request", json={"email": "lee@example.com"}).status_code == 202
    assert "SMTPAuthenticationError 535" in caplog.text and "bad key" not in caplog.text


def test_a_mail_that_did_not_leave_does_not_use_up_the_accounts_mails(world):
    client, _, outbox, _, _, app = world
    app.dependency_overrides[get_settings] = lambda: Settings(public_app_url=APP_URL, signup_daily_per_address=0, auth_secret="test-secret",
                                                              reset_daily_per_address=0, reset_daily_per_email=1, reset_daily_total=1)
    import smtplib

    class Down:
        def send(self, to, subject, text, html=None):
            raise smtplib.SMTPConnectError(421, b"try later")

    app.dependency_overrides[get_mailer] = lambda: Down()
    for _ in range(3):  # the mail server cannot be reached: nothing leaves, and nothing is used up
        assert client.post("/api/auth/reset/request", json={"email": "lee@example.com"}).status_code == 202
    app.dependency_overrides[get_mailer] = lambda: outbox
    assert client.post("/api/auth/reset/request", json={"email": "lee@example.com"}).status_code == 202
    assert len(outbox.sent) == 1  # the one that left; the account's one mail of the day was still there for it
    assert client.post("/api/auth/reset/request", json={"email": "lee@example.com"}).status_code == 202
    assert len(outbox.sent) == 1  # and now it is used up


def test_a_failure_that_may_have_come_after_the_mail_left_still_counts(world):
    client, _, outbox, _, _, app = world
    app.dependency_overrides[get_settings] = lambda: Settings(public_app_url=APP_URL, signup_daily_per_address=0, auth_secret="test-secret",
                                                              reset_daily_per_address=0, reset_daily_per_email=1, reset_daily_total=0)
    outbox.fails = True  # an OSError: it could have happened while closing, after the mail was taken
    assert client.post("/api/auth/reset/request", json={"email": "lee@example.com"}).status_code == 202
    outbox.fails = False
    assert client.post("/api/auth/reset/request", json={"email": "lee@example.com"}).status_code == 202
    assert outbox.sent == []  # the day's one mail was counted


# ---- wrong passwords, counted by the hour (2026-11-17) ----

def limited(app, per_hour: int, anywhere: int = 0, **more) -> None:
    """`per_hour`: one account from one address. `anywhere`: one account from every address together."""
    app.dependency_overrides[get_settings] = lambda: Settings(public_app_url=APP_URL, signup_daily_per_address=0, auth_secret="test-secret", trust_proxy=True,
                                                              reset_daily_per_address=0, reset_daily_per_email=0, reset_daily_total=0,
                                                              login_fails_per_hour=per_hour, login_fails_per_hour_any=anywhere, **more)


def at(address: str) -> dict:
    return {"X-Forwarded-For": address}


WRONG, RIGHT = {"email": "lee@example.com", "password": "wrong-password"}, {"email": "lee@example.com", "password": "password1"}


def counts(app) -> dict[str, int]:
    from sqlalchemy import select

    with next(app.dependency_overrides[get_session]()) as session:
        # Not the once-a-day mark of the daily removal (budget.forget_old): it is no one's count.
        return {bucket: count for bucket, count in session.execute(select(UsageDaily.bucket, UsageDaily.count)) if bucket != "sweep:day"}


def test_wrong_passwords_from_one_place_stop_that_place_for_the_hour_and_not_the_owner(world, monkeypatch):
    from datetime import datetime, timedelta

    from app.budget import KST
    from app.routes import auth as routes

    client, auth, _, _, _, app = world
    limited(app, 3)
    now = [datetime(2026, 11, 17, 14, 20, tzinfo=KST)]
    monkeypatch.setattr(routes, "_hour", lambda: now[0])
    guesser, owner = at("203.0.113.9"), at("198.51.100.7")
    # Signing in correctly any number of times uses nothing up, and neither does it clear what was got wrong.
    tries = [client.post("/api/auth/login", json=body, headers=guesser).status_code for body in (RIGHT, RIGHT, RIGHT, RIGHT, WRONG, WRONG, RIGHT, WRONG)]
    assert tries == [200, 200, 200, 200, 401, 401, 200, 401]
    stopped = client.post("/api/auth/login", json=RIGHT, headers=guesser)  # the right password waits as well: otherwise guessing could go on
    assert stopped.status_code == 429 and stopped.headers["retry-after"] == "2400" and "비밀번호를 다시 정" in stopped.json()["detail"]
    # Whoever guessed is stopped. The owner, somewhere else, signs in as always, and so does a session that is signed in.
    assert client.post("/api/auth/login", json=RIGHT, headers=owner).status_code == 200
    assert client.get("/api/auth/me", headers=auth).status_code == 200
    # Another account from the guesser's address is not touched either.
    client.post("/api/auth/signup", json={"email": "kim@example.com", "password": "password1", "name": "김"}, headers=guesser)
    assert client.post("/api/auth/login", json={"email": "kim@example.com", "password": "password1"}, headers=guesser).status_code == 200
    now[0] += timedelta(minutes=40)  # 15:00: a new hour
    assert client.post("/api/auth/login", json=RIGHT, headers=guesser).status_code == 200


def test_guesses_spread_over_many_addresses_stop_the_account_and_a_mailed_link_still_gets_in(world, monkeypatch):
    from datetime import datetime, timedelta

    from app.budget import KST
    from app.routes import auth as routes

    client, auth, outbox, _, _, app = world
    limited(app, 2, anywhere=5)
    now = [datetime(2026, 11, 17, 9, 0, tzinfo=KST)]
    monkeypatch.setattr(routes, "_hour", lambda: now[0])
    spread = [client.post("/api/auth/login", json=WRONG, headers=at(f"203.0.113.{n}")).status_code for n in range(1, 7)]
    assert spread == [401, 401, 401, 401, 401, 429]  # five from five places: the account's hour is used up
    assert client.post("/api/auth/login", json=RIGHT, headers=at("198.51.100.7")).status_code == 429  # now the owner waits too
    refused = counts(app)
    assert sorted(count for count in refused.values() if count) == [1, 1, 1, 1, 1, 5]  # a refused try is counted nowhere: what it took for its address was given back
    # A session that is signed in goes on, and the mailed link is the way in.
    assert client.get("/api/auth/me", headers=auth).status_code == 200
    assert client.post("/api/auth/reset/request", json={"email": "lee@example.com"}, headers=at("198.51.100.7")).status_code == 202
    assert client.post("/api/auth/reset/confirm", json={"token": outbox.link_token(), "password": "password2"}).status_code == 200
    now[0] += timedelta(hours=1)
    assert client.post("/api/auth/login", json={"email": "lee@example.com", "password": "password2"}, headers=at("198.51.100.7")).status_code == 200


def test_an_email_made_to_look_like_another_accounts_counter_does_not_stop_its_owner(world):
    """The two counts are kept under different names. Under one name, the count of everything typed for the made-up
    address "lee@example.com|198.51.100.7" was the same row as lee's own count at 198.51.100.7, so anyone who knew the
    owner's address could stop them from anywhere, without an account."""
    client, _, _, _, _, app = world
    limited(app, 3, anywhere=50)
    owner, elsewhere = at("198.51.100.7"), at("203.0.113.9")
    made_up = {"email": "lee@example.com|198.51.100.7", "password": "wrong-password"}
    # Since 2026-11-23 such an address is not an address at all (auth.EMAIL takes a bare mailbox): refused before anything is counted.
    assert [client.post("/api/auth/login", json=made_up, headers=elsewhere).status_code for _ in range(4)] == [422, 422, 422, 422]
    assert client.post("/api/auth/login", json=RIGHT, headers=owner).status_code == 200
    assert not [bucket for bucket, count in counts(app).items() if bucket.startswith("login:") and count]


def test_deleting_the_account_takes_the_counters_kept_under_its_id(world):
    """What is counted under the account's id is the account's: it is gone with it, not a week later. Counters under a
    hash of an address stay (they name nobody)."""
    from app.budget import take, today

    client, auth, _, _, _, app = world
    limited(app, 5)
    me = client.get("/api/auth/me", headers=auth).json()["user"]["id"]
    assert client.post("/api/auth/delete", headers=auth, json={"password": "wrong-password"}).status_code == 401
    with next(app.dependency_overrides[get_session]()) as session:
        take(session, f"ai:u:{me}", 100, today())
        take(session, "ai:g:someone-else", 100, today())
    assert sum(1 for bucket in counts(app) if me in bucket) == 2  # the wrong password just now, and the AI requests of the day
    assert client.post("/api/auth/delete", headers=auth, json={"password": "password1"}).status_code == 204
    left = counts(app)
    assert not [bucket for bucket in left if me in bucket] and left["ai:g:someone-else"] == 1


def test_an_address_without_an_account_is_stopped_and_checked_the_same_way(world, monkeypatch):
    """Otherwise the refusal, or how long the answer takes, would tell which addresses are registered."""
    from app.routes import auth as routes

    client, _, _, _, _, app = world
    limited(app, 2)
    checked, real = [], routes.verify_password
    monkeypatch.setattr(routes, "verify_password", lambda password, stored: checked.append(stored) or real(password, stored))
    nobody = {"email": "nobody@example.com", "password": "password1"}
    assert [client.post("/api/auth/login", json=nobody).status_code for _ in range(3)] == [401, 401, 429]
    # Each try that was let through did the work of checking a password, against a hash nothing matches.
    assert len(checked) == 2 and all(stored.startswith("pbkdf2_sha256$") for stored in checked) and len(set(checked)) == 1
    # Written differently, it is the same address.
    assert client.post("/api/auth/login", json={"email": " Nobody@Example.com ", "password": "password1"}).status_code == 429


def test_a_signed_in_sessions_tries_are_its_own_and_nobody_outside_can_use_them_up(world):
    """Changing the password and deleting the account both ask for the current password. A session someone else got
    hold of cannot guess without end, and wrong logins from outside do not keep the owner from changing the password."""
    client, auth, _, _, _, app = world
    limited(app, 3, anywhere=3)
    assert [client.post("/api/auth/login", json=WRONG, headers=at(f"203.0.113.{n}")).status_code for n in range(1, 5)] == [401, 401, 401, 429]
    assert client.post("/api/auth/login", json=RIGHT).status_code == 429  # the login form is closed for the hour...
    assert client.post("/api/auth/password", headers=auth, json={"currentPassword": "guess-one", "newPassword": "password9"}).status_code == 403  # ...the session is not
    assert client.post("/api/auth/delete", headers=auth, json={"password": "guess-two"}).status_code == 401
    assert client.post("/api/auth/password", headers=auth, json={"currentPassword": "guess-three", "newPassword": "password9"}).status_code == 403
    assert client.post("/api/auth/password", headers=auth, json={"currentPassword": "password1", "newPassword": "password9"}).status_code == 429
    assert client.post("/api/auth/delete", headers=auth, json={"password": "password1"}).status_code == 429
    assert client.get("/api/auth/me", headers=auth).status_code == 200  # nothing was changed or deleted

    limited(app, 0)  # off: nothing is counted or refused
    assert [client.post("/api/auth/login", json={"email": "lee@example.com", "password": "nope-nope"}).status_code for _ in range(5)] == [401] * 5
    changed = client.post("/api/auth/password", headers=auth, json={"currentPassword": "password1", "newPassword": "password9"})
    assert changed.status_code == 200
    assert client.post("/api/auth/delete", headers={"Authorization": f"Bearer {changed.json()['token']}"}, json={"password": "password9"}).status_code == 204


def test_the_counts_keep_no_address_and_a_right_password_leaves_nothing_behind(world):
    client, auth, _, _, _, app = world
    limited(app, 5, anywhere=50)
    for _ in range(3):
        assert client.post("/api/auth/login", json=RIGHT, headers=at("203.0.113.9")).status_code == 200
    assert client.post("/api/auth/password", headers=auth, json={"currentPassword": "password1", "newPassword": "password1"}).status_code == 200
    assert set(counts(app).values()) <= {0}  # every count that was taken was given back
    client.post("/api/auth/login", json=WRONG, headers=at("203.0.113.9"))
    kept = {bucket: count for bucket, count in counts(app).items() if count}
    assert len(kept) == 2 and all(bucket.startswith("login:") for bucket in kept)
    assert not any(part in bucket for bucket in kept for part in ("lee", "@", "203.0.113"))


def test_a_try_that_crosses_the_hour_or_midnight_gives_back_the_count_it_took(world, monkeypatch):
    from datetime import date, datetime

    from app import budget
    from app.budget import KST, Allowance
    from app.routes.auth import PasswordAttempt

    _, _, _, _, _, app = world
    with next(app.dependency_overrides[get_session]()) as session:
        late = PasswordAttempt(session, [("login:x", 5)], now=datetime(2026, 11, 17, 23, 59, 59, tzinfo=KST))
        other = PasswordAttempt(session, [("login:x", 5)], now=datetime(2026, 11, 18, 0, 0, 1, tzinfo=KST))  # someone's try in the new hour
        late.give_back()  # the first one turned out right, after midnight
        assert budget.used(session, "login:x:23", date(2026, 11, 17)) == 0 and budget.used(session, "login:x:00", date(2026, 11, 18)) == 1
        other.give_back()
        # The daily counters (sign-ups, mails) remember their day the same way.
        days = iter([date(2026, 11, 17), date(2026, 11, 18)])
        monkeypatch.setattr(budget, "today", lambda: next(days, date(2026, 11, 18)))
        yesterday = Allowance(session, "signup:y", 5, False)
        assert yesterday.take()
        budget.take(session, "signup:y", 5, date(2026, 11, 18))
        yesterday.give_back()
        assert budget.used(session, "signup:y", date(2026, 11, 17)) == 0 and budget.used(session, "signup:y", date(2026, 11, 18)) == 1


def test_a_mail_the_service_total_stopped_does_not_use_up_the_accounts_own(world):
    client, _, outbox, _, _, app = world
    app.dependency_overrides[get_settings] = lambda: Settings(public_app_url=APP_URL, signup_daily_per_address=0, auth_secret="test-secret",
                                                              reset_daily_per_address=0, reset_daily_per_email=1, reset_daily_total=1)
    client.post("/api/auth/signup", json={"email": "kim@example.com", "password": "password1", "name": "김"})
    for email in ("kim@example.com", "lee@example.com", "lee@example.com"):
        assert client.post("/api/auth/reset/request", json={"email": email}).status_code == 202
    assert [m["to"] for m in outbox.sent] == ["kim@example.com"]
    assert sorted(counts(app).values()) == [0, 1, 1]  # the total and kim's one; lee's own is still there for tomorrow's first mail


def test_the_whole_service_stops_sending_at_its_daily_total_and_still_answers_the_same(world, caplog):
    client, _, outbox, _, _, app = world
    app.dependency_overrides[get_settings] = lambda: Settings(public_app_url=APP_URL, signup_daily_per_address=0, auth_secret="test-secret",
                                                              reset_daily_per_address=0, reset_daily_per_email=0, reset_daily_total=2)
    client.post("/api/auth/signup", json={"email": "kim@example.com", "password": "password1", "name": "김"})
    with caplog.at_level("ERROR"):
        answers = [client.post("/api/auth/reset/request", json={"email": email}) for email in ("lee@example.com", "kim@example.com", "lee@example.com", "nobody@example.com")]
    assert [a.status_code for a in answers] == [202] * 4 and all(a.json() == {"sent": True} for a in answers)
    assert [m["to"] for m in outbox.sent] == ["lee@example.com", "kim@example.com"]  # the third had an account and got no mail
    assert caplog.text.count("RESET_DAILY_TOTAL") == 1  # an address without an account does not reach the count

"""Accounts (2026-11-02): sign up, log in, and the synced browser store that follows the account. Since 2026-11-17 also
changing the password, resetting a forgotten one by mail, and signing an account out everywhere.

Since 2026-11-18 (EMAIL_VERIFICATION on), a new account confirms its address by mail before it signs in, and an
account never confirmed (those made before) does not sign in or keep a session until it is: the right password at the
login form mails it a confirmation link. A reset link, which also proves the inbox, confirms it too.

Tokens are stateless (app/auth.py). Without AUTH_SECRET every route here answers 503 and the app stays guest-only, so a
deployment that has not set the secret yet is no worse than before accounts existed.
"""
import hmac
import smtplib
import socket
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field, StringConstraints, field_validator
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import TokenSigner, absent_hash, hash_password, needs_rehash, normalize_email, valid_email, verify_password
from ..budget import KST, Allowance, give_back, guest_key, signup_day, take
from ..config import Settings, get_settings
from ..db import get_session
from ..legal import get_legal
from ..mail import Mailer, failure as mail_failure, get_mailer, reset_mail, verify_mail
from ..models import UsageDaily, User
from ..ratelimit import client_address
from ..retention import stale_signup
from ..stats import count

log = logging.getLogger(__name__)
router = APIRouter()

Email = Annotated[str, StringConstraints(min_length=3, max_length=254)]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]
Name = Annotated[str, StringConstraints(min_length=1, max_length=16)]


class Credentials(BaseModel):
    email: Email
    password: Password

    @field_validator("email")
    @classmethod
    def normalized(cls, value: str) -> str:
        value = normalize_email(value)
        if not valid_email(value):
            raise ValueError("이메일 형식이 아니에요")
        return value


class SignupRequest(Credentials):
    name: Name
    # What the person agreed to on the form (2026-11-17), each on its own: the terms and the privacy policy, at the
    # version the form showed, and being of age. All three are needed, and the version must be the one in force.
    termsVersion: Annotated[str, StringConstraints(pattern=r"^[0-9A-Za-z.-]{1,20}$")] | None = None
    agreeTerms: bool = False
    agreePrivacy: bool = False
    adult: bool = False

    @field_validator("name")
    @classmethod
    def trimmed(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("이름을 입력해주세요")
        return value


class StoreUpload(BaseModel):
    store: dict
    # The version this upload was built on (GET /api/me/store). None: a browser still running the build from before
    # 2026-11-16, which is saved unconditionally as it always was.
    baseVersion: Annotated[int, Field(ge=0)] | None = None


class DeleteRequest(BaseModel):
    password: Password


class PasswordChange(BaseModel):
    currentPassword: Password
    newPassword: Password


class ResetRequest(BaseModel):
    email: Email

    @field_validator("email")
    @classmethod
    def normalized(cls, value: str) -> str:
        value = normalize_email(value)
        if not valid_email(value):
            raise ValueError("이메일 형식이 아니에요")
        return value


class VerifyConfirm(BaseModel):
    token: Annotated[str, StringConstraints(min_length=20, max_length=600)]


class ResetConfirm(BaseModel):
    token: Annotated[str, StringConstraints(min_length=20, max_length=600)]
    password: Password


def get_signer() -> TokenSigner | None:
    """None without AUTH_SECRET: accounts are off."""
    settings = get_settings()
    return TokenSigner(settings.auth_secret, settings.auth_token_days * 24 * 3600) if settings.auth_secret else None


def require_signer(signer: TokenSigner | None = Depends(get_signer)) -> TokenSigner:
    if signer is None:
        raise HTTPException(503, "이 서버에는 계정 기능이 설정되지 않았어요.")
    return signer


def current_user(authorization: Annotated[str | None, Header()] = None, signer: TokenSigner = Depends(require_signer),
                 session: Session = Depends(get_session), settings: Settings = Depends(get_settings)) -> User:
    user = _token_user(authorization, signer, session, settings)
    if user is None:
        raise HTTPException(401, "로그인이 필요해요.", headers={"WWW-Authenticate": "Bearer"})
    return user


def _token_user(authorization: str | None, signer: TokenSigner | None, session: Session, settings: Settings) -> User | None:
    """The account a bearer token belongs to, if the account still accepts it: the token's version must be the account's
    current one, so a changed password or "sign out everywhere" ends every token issued before. With EMAIL_VERIFICATION
    on, an account whose address was never confirmed accepts none: the browser is signed out (401) and the login form
    mails the link."""
    scheme, _, token = (authorization or "").partition(" ")
    claims = signer.session(token) if signer and scheme.lower() == "bearer" and token else None
    if not claims or not _is_uuid(claims[0]):
        return None
    user = session.get(User, uuid.UUID(claims[0]))
    if user is None or user.token_version != claims[1]:
        return None
    return None if settings.email_verification and user.email_verified_at is None else user


def optional_user_id(authorization: Annotated[str | None, Header()] = None, signer: TokenSigner | None = Depends(get_signer),
                     session: Session = Depends(get_session), settings: Settings = Depends(get_settings)) -> uuid.UUID | None:
    """Who is calling, if signed in. A stale or bad token only makes it a guest's request."""
    known = _token_user(authorization, signer, session, settings)
    return known.id if known else None


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


def public_user(user: User) -> dict:
    return {"id": str(user.id), "email": user.email, "name": user.name, "createdAt": _iso(user.created_at), **({"isAdmin": True} if user.is_admin else {})}


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value and value.tzinfo else (value.replace(tzinfo=timezone.utc).isoformat() if value else None)


def _session_answer(signer: TokenSigner, user: User, version: int | None = None) -> dict:
    """`version`: the token version a route's own UPDATE produced, when it changed it (not what a later read shows)."""
    return {"token": signer.issue(str(user.id), user.token_version if version is None else version), "user": public_user(user), "hasStore": user.store is not None}


@router.post("/api/auth/signup", status_code=201)
def signup(request: SignupRequest, http: Request, response: Response, session: Session = Depends(get_session),
           signer: TokenSigner = Depends(require_signer), day: Allowance = Depends(signup_day), settings: Settings = Depends(get_settings),
           mailer: Mailer | None = Depends(get_mailer)):
    """Makes the account. With EMAIL_VERIFICATION on it does not sign in: it mails a confirmation link and answers 202
    {"verify": "sent" | "failed"}; the account signs in once the link was opened. Off, it signs in at once (201)."""
    agreed = request.agreeTerms and request.agreePrivacy and request.adult and request.termsVersion == get_legal().version
    if settings.signup_consent_required and not agreed:
        if request.agreeTerms and request.agreePrivacy and request.adult and request.termsVersion:  # agreed, but to documents that are not the current ones
            raise HTTPException(409, "약관이 바뀌었어요. 페이지를 새로 고친 뒤 다시 가입해주세요.")
        raise HTTPException(422, "이용약관과 개인정보 수집·이용에 동의하고, 이용 가능한 나이인지 확인해주세요.")
    if settings.email_verification and mailer is None:
        raise HTTPException(503, "이 서버에는 메일 발송이 설정되지 않아 가입을 받을 수 없어요.")
    taken = HTTPException(409, "이미 가입된 이메일이에요. 로그인해주세요.")
    now = datetime.now(timezone.utc)
    known = session.scalar(select(User).where(User.email == request.email))
    if known is not None and session.execute(delete(User).where(User.id == known.id, *stale_signup(settings, now)),
                                         execution_options={"synchronize_session": False}).rowcount:
        session.commit()  # a sign-up never confirmed and past its days: the address is free again
        known = None
    if known is not None:
        if settings.email_verification and known.email_verified_at is None and known.last_login_at is None:
            # Not overwritten: whoever is waiting for this account's link would otherwise confirm an account someone else
            # set the password of. The inbox's owner takes it over with a reset link, which sets their own password.
            raise HTTPException(409, "이미 가입 신청된 이메일이에요. 메일함의 확인 메일을 열거나, 비밀번호를 모르면 비밀번호 재설정을 이용해주세요.")
        raise taken
    # An account raises the daily AI allowance, so accounts cannot be made without end from one place. Counted before the
    # account is made (one statement that checks and counts), so sign-ups arriving together cannot pass the limit; a
    # mistyped form or an address already registered was turned away above and uses nothing up.
    if not day.take():
        raise HTTPException(429, "오늘은 이 네트워크에서 더 가입할 수 없어요. 내일 다시 시도해주세요.")
    confirm = settings.email_verification
    user = User(email=request.email, name=request.name, password_hash=hash_password(request.password), last_login_at=None if confirm else now,
                terms_version=request.termsVersion if agreed else None, terms_agreed_at=now if agreed else None)
    session.add(user)
    try:
        session.commit()
    except IntegrityError:  # the same address signed up a moment earlier, between the look above and this commit
        session.rollback()
        day.give_back()  # no account was made: like the "already registered" answer above, it uses nothing up
        raise taken from None
    session.refresh(user)
    count(session, "signup")
    if confirm:
        response.status_code = 202
        return {"verify": "sent" if _send_verify(user, http, session, signer, mailer, settings) else "failed", "email": user.email}
    return _session_answer(signer, user)


def _send_verify(user: User, http: Request, session: Session, signer: TokenSigner, mailer: Mailer | None, settings: Settings) -> bool:
    """Mails `user` a confirmation link, within the day's counts: per calling address, per inbox (kept under the address
    itself, so deleting and making the account again starts nothing anew) and for the whole service. True if it left."""
    if mailer is None:
        return False
    secret = settings.auth_secret
    place = Allowance(session, f"verify:{guest_key(client_address(http, settings.trust_proxy), secret)}", settings.verify_daily_per_address, False)
    if not place.take():
        return False
    inbox = Allowance(session, f"verify:e:{guest_key(user.email, secret)}", settings.verify_daily_per_email, False)
    if not inbox.take():
        return False
    everyone = Allowance(session, "verify:total", settings.verify_daily_total, False)
    if not everyone.take():
        inbox.give_back()
        log.error("confirmation mail not sent: today's mails for the whole service are used up (VERIFY_DAILY_TOTAL)")
        return False
    token = signer.issue_verify(str(user.id), user.email, user.password_hash, settings.verify_link_hours * 3600)
    link = f"{settings.public_app_url.rstrip('/')}/#/verify/{token}"
    try:
        mailer.send(user.email, *verify_mail(user.name, link, settings.verify_link_hours))
        return True
    except Exception as error:  # noqa: BLE001 - the account is made; the person asks again by logging in
        log.error("confirmation mail could not be sent: %s", mail_failure(error))
        if isinstance(error, NOT_SENT):
            inbox.give_back()
            everyone.give_back()
        return False


def _hour() -> datetime:
    return datetime.now(KST)


class PasswordAttempt:
    """One try at a password, counted in each of `counters` (bucket, limit per hour) before the password is looked at, so
    tries arriving together cannot all slip under a limit. A try that turns out right is given back, which leaves the
    wrong ones counted. The hour and the day are read once, so the count that is given back is the one that was taken."""

    def __init__(self, session: Session, counters: list[tuple[str, int]], now: datetime | None = None):
        now = now or _hour()
        self.session, self.day, self.taken = session, now.date(), []
        for name, limit in counters:
            bucket = f"{name}:{now:%H}"
            if take(session, bucket, limit, self.day) is None:
                self.give_back()  # what the counters before this one took for this try
                wait = int((now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1) - now).total_seconds())
                raise HTTPException(429, "이 계정의 비밀번호를 여러 번 틀렸어요. 잠시 후 다시 시도하거나 비밀번호를 다시 정해주세요.",
                                    headers={"Retry-After": str(max(1, wait))})
            self.taken.append((bucket, limit))

    def give_back(self) -> None:
        for bucket, limit in self.taken:
            give_back(self.session, bucket, limit, self.day)
        self.taken = []


def login_attempt(email: str, http: Request, session: Session, settings: Settings) -> PasswordAttempt:
    """Wrong passwords at the login form are counted twice, both per hour:

    - for this account from this address (LOGIN_FAILS_PER_HOUR): the per-minute limit forgets with the minute, this adds
      the hour up. Someone guessing at an account is stopped; the owner, at another address, is not;
    - for this account from everywhere together (LOGIN_FAILS_PER_HOUR_ANY, much higher): guesses spread over many
      addresses stop too. Reaching it takes many addresses, and only then does the owner's own login wait as well (the
      mailed reset link still gets in, and sessions that are signed in go on).

    Counted for the address typed whether or not it has an account, so a refusal does not tell which are registered. Both
    the account and the caller are kept as keyed hashes, like a guest's (budget.py).

    The two counts have different names ("at", "all"), and the first hashes the email and the address one inside the
    other. The typed email is anything with an @ and a dot in it, "lee@example.com|198.51.100.7" included: were both
    counts named alike and the pair joined with a mark, that made-up email's count from everywhere would be the very row
    of lee's count at that address, and anyone could use it up from anywhere."""
    secret, address = settings.auth_secret, client_address(http, settings.trust_proxy)
    return PasswordAttempt(session, [(f"login:at:{guest_key(address, guest_key(email, secret))}", settings.login_fails_per_hour),
                                     (f"login:all:{guest_key(email, secret)}", settings.login_fails_per_hour_any)])


def password_attempt(user: User, session: Session, settings: Settings) -> PasswordAttempt:
    """Wrong current passwords from a signed-in session (changing the password, deleting the account): a session someone
    else got hold of cannot guess without end. Counted apart from the login form, under the account's id, so nobody
    outside the account can use these tries up and keep its owner from changing the password."""
    return PasswordAttempt(session, [(f"pw:{user.id}", settings.login_fails_per_hour)])


@router.post("/api/auth/login")
def login(request: Credentials, http: Request, session: Session = Depends(get_session), signer: TokenSigner = Depends(require_signer),
          settings: Settings = Depends(get_settings), mailer: Mailer | None = Depends(get_mailer)):
    attempt = login_attempt(request.email, http, session, settings)
    user = session.scalar(select(User).where(User.email == request.email))
    # One message for both cases, so the form does not reveal which emails have accounts. An address without an account is
    # checked against a hash nothing matches, so the answer takes as long as it does for one that has.
    checked = user.password_hash if user is not None else ""
    refused = HTTPException(401, "이메일 또는 비밀번호가 맞지 않아요.")
    if not verify_password(request.password, checked or absent_hash()) or user is None:
        raise refused
    if settings.email_verification and user.email_verified_at is None:
        # The right password, so this tells only the account's owner (or whoever has the password) that it waits for a
        # confirmation. A link is mailed again, for a new sign-up only within its keeping days (after them it is removed).
        attempt.give_back()
        fresh = user.last_login_at is not None or _aware(user.created_at) > datetime.now(timezone.utc) - timedelta(days=settings.unverified_keep_days)
        sent = fresh and _send_verify(user, http, session, signer, mailer, settings)
        raise HTTPException(403, "이메일 확인이 아직이에요. " + ("확인 메일을 보냈어요. 메일의 버튼을 누른 뒤 다시 로그인해주세요." if sent else
                                                       "지금은 확인 메일을 더 보낼 수 없어요. 받은 메일을 찾아보거나 내일 다시 시도해주세요."))
    # One UPDATE, and only if the stored hash is still the one just checked: a password changed or reset between the
    # check and here leaves this login with nothing (it proved the old password), and the token is issued for the
    # version this UPDATE saw, not for whatever a later read would show. A hash made with fewer rounds than are used now
    # is redone in the same statement, while the password is at hand.
    values = {"last_login_at": datetime.now(timezone.utc), **({"password_hash": hash_password(request.password)} if needs_rehash(checked) else {})}
    version = session.execute(update(User).where(User.id == user.id, User.password_hash == checked).values(**values)
                              .returning(User.token_version)).scalar()
    session.commit()
    if version is None:
        raise refused
    attempt.give_back()
    session.refresh(user)
    count(session, "login")
    return _session_answer(signer, user, version)


@router.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return {"user": public_user(user), "hasStore": user.store is not None, "storeUpdatedAt": _iso(user.store_updated_at),
            "storeVersion": user.store_version}


@router.get("/api/me/store")
def read_store(user: User = Depends(current_user)):
    return {"store": user.store, "updatedAt": _iso(user.store_updated_at), "version": user.store_version}


@router.put("/api/me/store")
def write_store(upload: StoreUpload, user: User = Depends(current_user), session: Session = Depends(get_session)):
    """Saves the whole browser store. With `baseVersion` the save happens only if no other device saved since that version
    (one UPDATE, so two uploads racing cannot both win); the refused device reads the newer store, merges and tries again."""
    size = len(json.dumps(upload.store, ensure_ascii=False).encode("utf-8"))
    if size > get_settings().store_max_bytes:
        raise HTTPException(413, "저장 데이터가 너무 커요. 오래된 기록을 정리한 뒤 다시 시도해주세요.")
    unchanged_since = [] if upload.baseVersion is None else [User.store_version == upload.baseVersion]
    # RETURNING: the version this very UPDATE produced. Reading the row again after the commit could return the version
    # of a save that came right after, and the browser would then build its next save on data it never saw.
    saved = session.execute(update(User).where(User.id == user.id, *unchanged_since)
                            .values(store=upload.store, store_updated_at=datetime.now(timezone.utc), store_version=User.store_version + 1)
                            .returning(User.store_version, User.store_updated_at)).first()
    if saved is None:
        session.rollback()
        raise HTTPException(409, "다른 기기에서 먼저 저장했어요. 최신 데이터를 받아 다시 저장해주세요.")
    session.commit()
    return {"updatedAt": _iso(saved.store_updated_at), "bytes": size, "version": saved.store_version}


@router.post("/api/auth/delete", status_code=204)
def delete_account(request: DeleteRequest, user: User = Depends(current_user), session: Session = Depends(get_session),
                   settings: Settings = Depends(get_settings)):
    attempt = password_attempt(user, session, settings)
    if not verify_password(request.password, user.password_hash):
        raise HTTPException(401, "비밀번호가 맞지 않아요.")
    attempt.give_back()
    # The counters kept under the account's id (its AI requests of the day, its wrong current passwords) go with it, not
    # seven days later: they are the only other rows that name the account. Counters kept under a keyed hash of an
    # address or an email stay for their seven days, as the policy says (src/legal.ts).
    session.execute(delete(UsageDaily).where(or_(UsageDaily.bucket == f"ai:u:{user.id}", UsageDaily.bucket.startswith(f"pw:{user.id}:"))))
    session.delete(user)
    session.commit()
    return Response(status_code=204)


# ---- passwords and sessions (2026-11-17) ----

def _end_sessions(user: User, session: Session) -> None:
    """Every token issued so far stops working. One UPDATE, so two of these at once still move the number on twice."""
    session.execute(update(User).where(User.id == user.id).values(token_version=User.token_version + 1))
    session.commit()


def _replace_password(user: User, session: Session, checked_hash: str, password: str, **also) -> int | None:
    """Sets a new password and ends every session, but only if the stored hash is still the one that was checked: one
    UPDATE, so of two requests holding the same reset link (or the same old password) exactly one wins, and neither can
    undo a change that was finished in between. Returns the token version this UPDATE produced (RETURNING: reading the
    row again could show a later one, and hand a token that outlives someone else's "sign out everywhere"), or None."""
    version = session.execute(update(User).where(User.id == user.id, User.password_hash == checked_hash)
                              .values(password_hash=hash_password(password), token_version=User.token_version + 1, **also)
                              .returning(User.token_version)).scalar()
    session.commit()
    if version is not None:
        session.refresh(user)
    return version


@router.post("/api/auth/password")
def change_password(request: PasswordChange, user: User = Depends(current_user), session: Session = Depends(get_session),
                    signer: TokenSigner = Depends(require_signer), settings: Settings = Depends(get_settings)):
    """A new password ends every other session; this one continues with the token in the answer. A wrong current
    password is 403, so the browser can tell it from an ended session (401)."""
    attempt = password_attempt(user, session, settings)
    checked = user.password_hash
    if not verify_password(request.currentPassword, checked):
        raise HTTPException(403, "현재 비밀번호가 맞지 않아요.")
    attempt.give_back()
    version = _replace_password(user, session, checked, request.newPassword)
    if version is None:  # changed elsewhere between the check and the save
        raise HTTPException(401, "비밀번호가 방금 다른 곳에서 바뀌었어요. 다시 로그인해주세요.", headers={"WWW-Authenticate": "Bearer"})
    return _session_answer(signer, user, version)


@router.post("/api/auth/logout-all", status_code=204)
def logout_everywhere(user: User = Depends(current_user), session: Session = Depends(get_session)):
    """Signs the account out on every device, this one included (a lost phone, a shared computer left signed in)."""
    _end_sessions(user, session)
    return Response(status_code=204)


RESET_SENT = {"sent": True}


@router.post("/api/auth/reset/request", status_code=202)
def request_reset(request: ResetRequest, http: Request, session: Session = Depends(get_session), signer: TokenSigner = Depends(require_signer),
                  mailer: Mailer | None = Depends(get_mailer), settings: Settings = Depends(get_settings)):
    """Mails a reset link if the address has an account. The answer is the same either way, so the form does not tell
    which addresses are registered; whether a mail really left is in the log only."""
    if mailer is None:
        raise HTTPException(503, "이 서버에는 메일 발송이 설정되지 않았어요.")
    address = client_address(http, settings.trust_proxy)
    if not Allowance(session, f"reset:{guest_key(address, settings.auth_secret)}", settings.reset_daily_per_address, False).take():
        raise HTTPException(429, "오늘은 더 요청할 수 없어요. 내일 다시 시도해주세요.")
    user = session.scalar(select(User).where(User.email == request.email))
    if user is None:
        return RESET_SENT
    # Per account as well, whoever asks and from wherever: an inbox cannot be flooded with these.
    mine = Allowance(session, f"reset:e:{guest_key(user.email, settings.auth_secret)}", settings.reset_daily_per_email, False)
    if not mine.take():
        log.warning("reset mail not sent: today's mails for this account are used up")
        return RESET_SENT
    everyone = Allowance(session, "reset:total", settings.reset_daily_total, False)
    if not everyone.take():
        mine.give_back()  # no mail leaves, so this account's own three are not used up by it
        log.error("reset mail not sent: today's mails for the whole service are used up (RESET_DAILY_TOTAL)")
        return RESET_SENT
    token = signer.issue_reset(str(user.id), user.password_hash, settings.reset_token_minutes * 60)
    link = f"{settings.public_app_url.rstrip('/')}/#/reset/{token}"
    try:
        mailer.send(user.email, *reset_mail(user.name, link, settings.reset_token_minutes))
    except Exception as error:  # noqa: BLE001 - the form's answer must not depend on whether this address has an account
        log.error("reset mail could not be sent: %s", mail_failure(error))
        # A failure that surely sent nothing (the server could not be reached or signed in to, or refused the sender, the
        # recipient or the message) gives back the account's mails and the service's, so trying again later works. Other
        # failures may come after the mail was taken, and count. The address's count always stays: it is what stops one
        # place from asking without end.
        if isinstance(error, NOT_SENT):
            mine.give_back()
            everyone.give_back()
    return RESET_SENT


# Failures before the mail server took the message (smtplib raises these from connect, login, MAIL, RCPT and DATA).
NOT_SENT = (smtplib.SMTPConnectError, smtplib.SMTPAuthenticationError, smtplib.SMTPSenderRefused, smtplib.SMTPRecipientsRefused,
            smtplib.SMTPDataError, ConnectionRefusedError, socket.gaierror)


@router.post("/api/auth/verify")
def confirm_email(request: VerifyConfirm, session: Session = Depends(get_session), signer: TokenSigner = Depends(require_signer)):
    """Confirms the address from the mailed link, on the person's own click in the page (a mail scanner that fetches the
    link does nothing). It does not sign in: the person logs in with their password next, so a leaked link is not a
    session. The link holds only while the account has the address and the password it was mailed for; opened again
    after it worked, it says the address is confirmed."""
    claims = signer.verify_claims(request.token)
    user = session.get(User, uuid.UUID(claims[0])) if claims and _is_uuid(claims[0]) else None
    spent = HTTPException(400, "링크가 만료됐거나 더 이상 쓸 수 없어요. 로그인하면 확인 메일을 다시 보내 드려요.")
    if user is None or not hmac.compare_digest(signer.fingerprint(f"email|{user.email}"), claims[1]):
        raise spent
    checked = user.password_hash
    if not hmac.compare_digest(signer.fingerprint(checked), claims[2]):
        raise spent
    # One UPDATE, only while still unconfirmed and still on the password the link names.
    session.execute(update(User).where(User.id == user.id, User.password_hash == checked, User.email_verified_at.is_(None))
                    .values(email_verified_at=datetime.now(timezone.utc)))
    session.commit()
    session.refresh(user)
    if user.email_verified_at is None:  # the password changed in between
        raise spent
    count(session, "verify")
    return {"verified": True, "email": user.email}


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


@router.post("/api/auth/reset/confirm")
def confirm_reset(request: ResetConfirm, session: Session = Depends(get_session), signer: TokenSigner = Depends(require_signer)):
    """Sets the new password from a mailed link. The link works once: it names the password it was issued for, and that
    password is gone after this. Every session of the account ends; the answer signs this browser in."""
    claims = signer.reset(request.token)
    user = session.get(User, uuid.UUID(claims[0])) if claims and _is_uuid(claims[0]) else None
    checked = user.password_hash if user is not None else ""
    spent = HTTPException(400, "링크가 만료됐거나 이미 사용됐어요. 비밀번호 재설정을 다시 요청해주세요.")
    if user is None or not hmac.compare_digest(signer.fingerprint(checked), claims[1]):
        raise spent
    # The link reached the inbox, so the address is confirmed too (kept as it was if it already was).
    now = datetime.now(timezone.utc)
    version = _replace_password(user, session, checked, request.password, last_login_at=now,
                                email_verified_at=func.coalesce(User.email_verified_at, now))
    if version is None:  # the same link, used a moment earlier by another request
        raise spent
    return _session_answer(signer, user, version)

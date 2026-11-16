"""Accounts (2026-11-02): sign up, log in, and the synced browser store that follows the account.

Tokens are stateless (app/auth.py). Without AUTH_SECRET every route here answers 503 and the app stays guest-only, so a
deployment that has not set the secret yet is no worse than before accounts existed.
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field, StringConstraints, field_validator
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..auth import TokenSigner, hash_password, normalize_email, valid_email, verify_password
from ..budget import signup_allowed
from ..config import get_settings
from ..db import get_session
from ..models import User

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


def get_signer() -> TokenSigner | None:
    """None without AUTH_SECRET: accounts are off."""
    settings = get_settings()
    return TokenSigner(settings.auth_secret, settings.auth_token_days * 24 * 3600) if settings.auth_secret else None


def require_signer(signer: TokenSigner | None = Depends(get_signer)) -> TokenSigner:
    if signer is None:
        raise HTTPException(503, "이 서버에는 계정 기능이 설정되지 않았어요.")
    return signer


def current_user(authorization: Annotated[str | None, Header()] = None, signer: TokenSigner = Depends(require_signer),
                 session: Session = Depends(get_session)) -> User:
    scheme, _, token = (authorization or "").partition(" ")
    user_id = signer.verify(token) if scheme.lower() == "bearer" and token else None
    user = session.get(User, uuid.UUID(user_id)) if user_id and _is_uuid(user_id) else None
    if user is None:
        raise HTTPException(401, "로그인이 필요해요.", headers={"WWW-Authenticate": "Bearer"})
    return user


def optional_user_id(authorization: Annotated[str | None, Header()] = None, signer: TokenSigner | None = Depends(get_signer),
                     session: Session = Depends(get_session)) -> uuid.UUID | None:
    """Who is calling, if signed in. A stale or bad token only makes it a guest's request."""
    scheme, _, token = (authorization or "").partition(" ")
    user_id = signer.verify(token) if signer and scheme.lower() == "bearer" and token else None
    if not user_id or not _is_uuid(user_id):
        return None
    known = session.get(User, uuid.UUID(user_id))
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


def _session_answer(signer: TokenSigner, user: User) -> dict:
    return {"token": signer.issue(str(user.id)), "user": public_user(user), "hasStore": user.store is not None}


@router.post("/api/auth/signup", status_code=201)
def signup(request: SignupRequest, session: Session = Depends(get_session), signer: TokenSigner = Depends(require_signer),
           allowed: bool = Depends(signup_allowed)):
    if not allowed:  # an account raises the daily AI allowance, so accounts cannot be made without end from one place
        raise HTTPException(429, "오늘은 이 네트워크에서 더 가입할 수 없어요. 내일 다시 시도해주세요.")
    if session.scalar(select(User).where(User.email == request.email)) is not None:
        raise HTTPException(409, "이미 가입된 이메일이에요. 로그인해주세요.")
    user = User(email=request.email, name=request.name, password_hash=hash_password(request.password),
                last_login_at=datetime.now(timezone.utc))
    session.add(user)
    session.commit()
    session.refresh(user)
    return _session_answer(signer, user)


@router.post("/api/auth/login")
def login(request: Credentials, session: Session = Depends(get_session), signer: TokenSigner = Depends(require_signer)):
    user = session.scalar(select(User).where(User.email == request.email))
    # One message for both cases, so the form does not reveal which emails have accounts.
    if user is None or not verify_password(request.password, user.password_hash):
        raise HTTPException(401, "이메일 또는 비밀번호가 맞지 않아요.")
    user.last_login_at = datetime.now(timezone.utc)
    session.commit()
    return _session_answer(signer, user)


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
def delete_account(request: DeleteRequest, user: User = Depends(current_user), session: Session = Depends(get_session)):
    if not verify_password(request.password, user.password_hash):
        raise HTTPException(401, "비밀번호가 맞지 않아요.")
    session.delete(user)
    session.commit()
    return Response(status_code=204)

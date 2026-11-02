"""Accounts: hashing and tokens (pure), and the routes on an SQLite users table (no PostgreSQL needed)."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import TokenSigner, hash_password, normalize_email, valid_email, verify_password
from app.db import get_session
from app.main import create_app
from app.models import User
from app.routes.auth import get_signer


def test_password_hash_round_trip_and_rejects_garbage():
    stored = hash_password("correct horse", iterations=1000)
    assert stored.startswith("pbkdf2_sha256$1000$")
    assert verify_password("correct horse", stored)
    assert not verify_password("wrong", stored)
    assert not verify_password("correct horse", "plain$text")
    assert not verify_password("correct horse", "")
    assert hash_password("same", 1000) != hash_password("same", 1000)  # a fresh salt every time


def test_email_normalization():
    assert normalize_email("  Kim@Example.COM ") == "kim@example.com"
    assert valid_email("a@b.co") and not valid_email("no-at-sign") and not valid_email("a b@c.d")


def test_tokens_expire_and_fail_closed():
    clock = {"now": 1_000.0}
    signer = TokenSigner("secret", ttl_seconds=60, now=lambda: clock["now"])
    token = signer.issue("user-1")
    assert signer.verify(token) == "user-1"
    assert TokenSigner("other", now=lambda: clock["now"]).verify(token) is None
    assert signer.verify(token + "x") is None and signer.verify("") is None and signer.verify("a.b.c") is None
    clock["now"] = 1_061.0
    assert signer.verify(token) is None


@pytest.fixture
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    User.__table__.create(engine)
    make = sessionmaker(engine, expire_on_commit=False)

    def session():
        with make() as s:
            yield s

    app = create_app()
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[get_signer] = lambda: TokenSigner("test-secret", ttl_seconds=3600)
    with TestClient(app) as c:
        yield c


SIGNUP = {"email": "Lee@Example.com", "password": "password1", "name": " 주형 "}


def test_signup_login_and_me(client):
    created = client.post("/api/auth/signup", json=SIGNUP)
    assert created.status_code == 201
    body = created.json()
    assert body["user"]["email"] == "lee@example.com" and body["user"]["name"] == "주형" and body["hasStore"] is False
    assert "password" not in body["user"] and "passwordHash" not in body["user"]
    auth = {"Authorization": f"Bearer {body['token']}"}
    assert client.get("/api/auth/me", headers=auth).json()["user"]["email"] == "lee@example.com"

    assert client.post("/api/auth/signup", json=SIGNUP).status_code == 409
    assert client.post("/api/auth/login", json={"email": "lee@example.com", "password": "wrong-pass"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-pass"}).status_code == 401
    logged = client.post("/api/auth/login", json={"email": "LEE@example.com ", "password": "password1"})
    assert logged.status_code == 200 and logged.json()["user"]["id"] == body["user"]["id"]


def test_signup_validates_input(client):
    assert client.post("/api/auth/signup", json={**SIGNUP, "email": "not-an-email"}).status_code == 422
    assert client.post("/api/auth/signup", json={**SIGNUP, "password": "short"}).status_code == 422
    assert client.post("/api/auth/signup", json={**SIGNUP, "name": "   "}).status_code == 422
    assert client.post("/api/auth/signup", json={**SIGNUP, "name": "x" * 17}).status_code == 422


def test_store_sync_requires_a_valid_token_and_limits_size(client):
    token = client.post("/api/auth/signup", json=SIGNUP).json()["token"]
    auth = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/me/store").status_code == 401
    assert client.get("/api/me/store", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get("/api/me/store", headers=auth).json() == {"store": None, "updatedAt": None}

    store = {"version": 2, "name": "주형", "favorites": ["f01"], "history": []}
    saved = client.put("/api/me/store", json={"store": store}, headers=auth)
    assert saved.status_code == 200 and saved.json()["bytes"] > 0
    read = client.get("/api/me/store", headers=auth).json()
    assert read["store"] == store and read["updatedAt"] is not None
    assert client.get("/api/auth/me", headers=auth).json()["hasStore"] is True

    big = {"history": ["x" * 1_100_000]}
    assert client.put("/api/me/store", json={"store": big}, headers=auth).status_code == 413
    assert client.get("/api/me/store", headers=auth).json()["store"] == store  # the oversized upload changed nothing


def test_delete_account_needs_the_password(client):
    token = client.post("/api/auth/signup", json=SIGNUP).json()["token"]
    auth = {"Authorization": f"Bearer {token}"}
    assert client.post("/api/auth/delete", json={"password": "wrong-pass"}, headers=auth).status_code == 401
    assert client.post("/api/auth/delete", json={"password": "password1"}, headers=auth).status_code == 204
    assert client.get("/api/auth/me", headers=auth).status_code == 401
    assert client.post("/api/auth/signup", json=SIGNUP).status_code == 201  # the email is free again


def test_auth_routes_answer_503_without_a_secret():
    app = create_app()
    app.dependency_overrides[get_signer] = lambda: None
    with TestClient(app) as client:
        assert client.post("/api/auth/login", json={"email": "a@b.co", "password": "password1"}).status_code == 503
        assert client.get("/api/auth/me", headers={"Authorization": "Bearer x"}).status_code == 503

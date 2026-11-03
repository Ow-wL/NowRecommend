"""Error reports: anyone can send one; only an account marked admin can read or settle them."""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.ai_items import persist_picks
from app.auth import TokenSigner
from app.catalog import load_seed, seed_items
from app.db import get_session
from app.llm.free import FreePick
from app.main import create_app
from app.models import Item, Report, User
from app.ratelimit import LIMITED_PATHS
from app.routes.auth import get_signer
from app.vocab import get_vocab
from tests.conftest import needs_db

pytestmark = needs_db
SIGNER = TokenSigner("test-secret", ttl_seconds=3600)


@pytest.fixture
def client(db_session):
    seed_items(db_session, get_vocab(), load_seed())
    app = create_app()
    app.dependency_overrides[get_session] = lambda: db_session
    app.dependency_overrides[get_signer] = lambda: SIGNER
    with TestClient(app) as c:
        yield c


def account(session, admin=False) -> dict:
    user = User(email=f"{uuid.uuid4().hex}@example.com", name="n", password_hash="x", is_admin=admin)
    session.add(user)
    session.commit()
    return {"Authorization": f"Bearer {SIGNER.issue(str(user.id))}"}


def test_anyone_can_report_and_the_name_comes_from_the_server(client, db_session):
    answer = client.post("/api/reports", json={"itemId": "f13", "kind": "wrong_image", "note": "  다른 사진이에요 ", "itemName": "가짜 이름", "image": "https://evil.example/x.png"})
    assert answer.status_code == 201
    row = db_session.get(Report, uuid.UUID(answer.json()["id"]))
    assert row.item_name == "치킨" and row.note == "다른 사진이에요" and row.user_id is None and row.status == "open"


def test_bad_reports_are_refused(client):
    assert client.post("/api/reports", json={"itemId": "no-such-item", "kind": "other"}).status_code == 404
    assert client.post("/api/reports", json={"itemId": "f13", "kind": "made_up"}).status_code == 422
    assert client.post("/api/reports", json={"itemId": "f13", "kind": "other", "note": "가" * 301}).status_code == 422
    assert "/api/reports" in LIMITED_PATHS


def test_a_bad_token_only_makes_it_a_guests_report_and_a_member_is_remembered(client, db_session):
    assert client.post("/api/reports", json={"itemId": "f13", "kind": "other"}, headers={"Authorization": "Bearer junk"}).status_code == 201
    member = client.post("/api/reports", json={"itemId": "f13", "kind": "other"}, headers=account(db_session)).json()["id"]
    assert db_session.get(Report, uuid.UUID(member)).user_id is not None


def test_only_an_admin_reads_and_settles(client, db_session):
    report = client.post("/api/reports", json={"itemId": "f13", "kind": "wrong_image"}).json()["id"]
    member, admin = account(db_session), account(db_session, admin=True)
    for headers, code in (({}, 401), ({"Authorization": "Bearer junk"}, 401), (member, 403)):
        assert client.get("/api/admin/reports", headers=headers).status_code == code
        assert client.post(f"/api/admin/reports/{report}", json={"status": "resolved"}, headers=headers).status_code == code
    assert db_session.get(Report, uuid.UUID(report)).status == "open"
    listed = client.get("/api/admin/reports", headers=admin).json()
    assert listed["counts"]["open"] >= 1 and any(r["id"] == report and r["item"]["name"] == "치킨" and r["byMember"] is False for r in listed["reports"])
    settled = client.post(f"/api/admin/reports/{report}", json={"status": "resolved"}, headers=admin).json()
    assert settled["status"] == "resolved" and settled["resolvedAt"]
    assert report not in [r["id"] for r in client.get("/api/admin/reports", headers=admin).json()["reports"]]
    assert report in [r["id"] for r in client.get("/api/admin/reports?status=resolved", headers=admin).json()["reports"]]
    assert client.post(f"/api/admin/reports/{report}", json={"status": "open"}, headers=admin).json()["resolvedAt"] is None
    assert client.post(f"/api/admin/reports/{uuid.uuid4()}", json={"status": "open"}, headers=admin).status_code == 404


def test_signing_up_cannot_make_an_admin(client, db_session):
    answer = client.post("/api/auth/signup", json={"email": f"{uuid.uuid4().hex}@example.com", "password": "password1", "name": "n", "isAdmin": True, "is_admin": True})
    assert answer.status_code == 201 and "isAdmin" not in answer.json()["user"]
    assert not db_session.scalar(select(User).where(User.email == answer.json()["user"]["email"])).is_admin


def test_dropping_a_borrowed_picture_lasts_through_the_next_pick_and_only_applies_to_ai_picks(client, db_session):
    pick = FreePick("인절미 빙수", "카페 · 디저트", "t", "c", "high", [], [], "치킨")
    row = persist_picks(db_session, "food", [pick])[0]
    assert row.parent_id == "f13"
    report = client.post("/api/reports", json={"itemId": row.id, "kind": "wrong_image"}).json()["id"]
    admin = account(db_session, admin=True)
    assert next(r for r in client.get("/api/admin/reports", headers=admin).json()["reports"] if r["id"] == report)["canDropImage"] is True
    done = client.post(f"/api/admin/reports/{report}", json={"status": "resolved", "dropImage": True}, headers=admin).json()
    assert done["canDropImage"] is False and "parentId" not in done["item"]
    assert persist_picks(db_session, "food", [pick])[0].parent_id == ""
    assert "parentId" not in client.post("/api/recommend", json={"category": "food", "engine": "catalog"}).json()["results"][0]["item"]
    plain = client.post("/api/reports", json={"itemId": "f13", "kind": "wrong_image"}).json()["id"]
    assert client.post(f"/api/admin/reports/{plain}", json={"dropImage": True}, headers=admin).status_code == 409


def test_deleting_an_account_keeps_the_report_without_its_author(client, db_session):
    user = User(email=f"{uuid.uuid4().hex}@example.com", name="n", password_hash="x")
    db_session.add(user)
    db_session.commit()
    headers = {"Authorization": f"Bearer {SIGNER.issue(str(user.id))}"}
    report = uuid.UUID(client.post("/api/reports", json={"itemId": "f13", "kind": "other"}, headers=headers).json()["id"])
    db_session.delete(user)
    db_session.commit()
    db_session.expire_all()
    assert db_session.get(Report, report).user_id is None
    assert db_session.get(Item, "f13") is not None

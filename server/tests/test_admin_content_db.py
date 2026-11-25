"""The admin console's content and recommendation views on PostgreSQL (2026-11-26): hiding an item takes it out of the
catalog, retrieval and AI picks, survives the seed job, and is recorded; the request log is read without its text."""
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.ai_items import persist_picks
from app.auth import TokenSigner
from app.catalog import load_seed, reviewed_items, seed_items
from app.db import get_session
from app.llm.free import FreePick
from app.main import create_app
from app.models import AdminAudit, Item, RecommendationLog, User
from app.retrieval.filters import eligible_query
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


def admin(session) -> dict:
    user = User(email=f"{uuid.uuid4().hex}@example.com", name="관리자", password_hash="x", is_admin=True)
    session.add(user)
    session.commit()
    return {"Authorization": f"Bearer {SIGNER.issue(str(user.id))}"}


def test_a_hidden_item_leaves_the_catalog_and_retrieval_and_comes_back_when_shown(client, db_session):
    headers = admin(db_session)
    before = client.post("/api/admin/items/search", json={"q": "김치", "category": "food"}, headers=headers).json()
    target = before["items"][0]
    assert client.post(f"/api/admin/items/{target['id']}/hide", json={"reason": " "}, headers=headers).status_code == 422
    hidden = client.post(f"/api/admin/items/{target['id']}/hide", json={"reason": "사진이 계속 틀림"}, headers=headers).json()
    assert hidden["hiddenAt"] and hidden["status"] == "reviewed"  # the review status is not touched
    assert target["id"] not in {i["id"] for i in client.get("/api/catalog").json()["items"]}
    assert target["id"] not in {r.id for r in db_session.scalars(eligible_query("food", [], [], [], None))}
    assert client.post("/api/admin/items/search", json={"status": "hidden"}, headers=headers).json()["total"] == 1
    # The seed job of a new image keeps it hidden.
    seed_items(db_session, get_vocab(), load_seed())
    db_session.expire_all()
    assert db_session.get(Item, target["id"]).hidden_at is not None
    assert target["id"] not in {r.id for r in reviewed_items(db_session)}
    shown = client.post(f"/api/admin/items/{target['id']}/show", json={}, headers=headers).json()
    assert shown["hiddenAt"] is None and target["id"] in {i["id"] for i in client.get("/api/catalog").json()["items"]}
    assert [a.action for a in db_session.scalars(select(AdminAudit).where(AdminAudit.target_id == target["id"]).order_by(AdminAudit.id))] == ["hide_item", "show_item"]
    details = client.get(f"/api/admin/items/{target['id']}", headers=headers).json()
    assert [a["action"] for a in details["actions"]] == ["show_item", "hide_item"] and details["shown30d"] == 0


def test_an_ai_pick_naming_a_hidden_item_is_dropped(client, db_session):
    headers = admin(db_session)
    picks = persist_picks(db_session, "music", [FreePick(name="숨길 노래", detail="가수", taste_reason="", context_reason="", confidence="high")])
    row = picks[0]
    client.post(f"/api/admin/items/{row.id}/hide", json={"reason": "없는 곡"}, headers=headers)
    db_session.expire_all()
    again = persist_picks(db_session, "music", [FreePick(name="숨길 노래", detail="가수", taste_reason="", context_reason="", confidence="high")])
    assert again[0].id == row.id and again[0].hidden_at is not None  # ask_model drops it (issues["hidden"])


def test_the_request_log_is_read_without_text_and_by_kind(client, db_session):
    headers = admin(db_session)
    now = datetime.now(timezone.utc)
    db_session.add_all([
        RecommendationLog(category="food", raw_text="비밀 문장", conditions={"tags": ["매콤함"], "excluded": ["땅콩"]}, params={"engine": "ai", "issues": "extra=1"},
                          candidate_ids=[], candidate_scores={}, result_ids=["f01", "f02"], mode="rag", latency_ms=800, created_at=now),
        RecommendationLog(category="music", raw_text=None, conditions={"tags": []}, params={}, candidate_ids=[], candidate_scores={}, result_ids=["m01"],
                          mode="retrieval_only", latency_ms=300, error="rerank:TimeoutError some detail", created_at=now),
    ])
    db_session.commit()
    board = client.get("/api/admin/recommendations", params={"days": 7}, headers=headers).json()
    assert board["summary"]["requests"] == 2 and board["summary"]["ai"] == 1 and board["summary"]["errors"] == 1
    assert "비밀 문장" not in str(board)
    failed = client.get("/api/admin/recommendations", params={"days": 7, "kind": "failed"}, headers=headers).json()["recent"]
    assert [r["error"] for r in failed] == ["rerank:TimeoutError"]
    catalog = client.get("/api/admin/recommendations", params={"days": 7, "kind": "catalog"}, headers=headers).json()["recent"]
    assert [r["category"] for r in catalog] == ["music"]
    assert client.get("/api/admin/items/f01", headers=headers).json()["shown30d"] == 1
    assert client.get("/api/admin/system", headers=headers).json()["database"]["ok"] is True

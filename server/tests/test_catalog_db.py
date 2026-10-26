import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.catalog import load_seed, published_items, refresh_embeddings, seed_items
from app.db import get_session
from app.main import create_app
from app.models import Item
from app.vocab import get_vocab
from tests.conftest import FakeEmbedder, needs_db

pytestmark = [pytest.mark.db, needs_db]


def client_for(session):
    app = create_app()
    app.dependency_overrides[get_session] = lambda: session
    return TestClient(app)


def test_seed_is_idempotent_and_reviewed(db_session):
    first = seed_items(db_session, get_vocab(), load_seed())
    second = seed_items(db_session, get_vocab(), load_seed())
    assert (first.inserted, first.updated) == (31, 0)
    assert (second.inserted, second.updated, second.unchanged) == (0, 0, 31)
    rows = db_session.scalars(select(Item)).all()
    assert {r.status for r in rows} == {"reviewed"} and {r.source for r in rows} == {"seed"}


def test_seed_updates_changed_item(db_session):
    seed_items(db_session, get_vocab(), load_seed())
    items = load_seed()
    items[0] = {**items[0], "description": "바뀐 설명"}
    assert seed_items(db_session, get_vocab(), items).updated == 1
    db_session.expire_all()
    assert db_session.get(Item, items[0]["id"]).description == "바뀐 설명"


def test_seed_rejects_invalid_file(db_session):
    items = load_seed()
    items[0] = {**items[0], "tags": ["없는태그"]}
    with pytest.raises(ValueError, match="태그"):
        seed_items(db_session, get_vocab(), items)
    assert db_session.scalars(select(Item)).all() == []


def test_embeddings_refresh_only_changed_items(db_session):
    seed_items(db_session, get_vocab(), load_seed())
    embedder = FakeEmbedder()
    assert len(refresh_embeddings(db_session, embedder)) == 31
    assert refresh_embeddings(db_session, embedder) == []
    db_session.get(Item, "m01").description = "새 설명"
    db_session.commit()
    assert refresh_embeddings(db_session, embedder, dry_run=True) == ["m01"]
    assert refresh_embeddings(db_session, embedder) == ["m01"]
    assert len(embedder.calls) == 2 and embedder.calls[1][0].startswith("title: 밤편지 - 아이유")
    assert len(db_session.get(Item, "m01").embedding) == 768


def test_catalog_api_matches_frontend_item_shape(db_session):
    seed_items(db_session, get_vocab(), load_seed())
    seed = {i["id"]: i for i in load_seed()}
    with client_for(db_session) as client:
        everything = client.get("/api/catalog").json()
        food = client.get("/api/catalog", params={"category": "food"}).json()
        music = client.get("/api/catalog", params={"category": "music"}).json()
        assert client.get("/api/catalog", params={"category": "drink"}).status_code == 422
    assert len(everything["items"]) == 31 and len(food["items"]) == 16 and len(music["items"]) == 15
    assert everything["catalogVersion"] == food["catalogVersion"] == music["catalogVersion"]
    f01 = next(i for i in food["items"] if i["id"] == "f01")
    assert f01["price"] == seed["f01"]["price_label"] and f01["cost"] == seed["f01"]["cost"]
    m01 = next(i for i in music["items"] if i["id"] == "m01")
    assert "price" not in m01 and "cost" not in m01 and m01["subtitle"] == "아이유"
    assert "embedding" not in m01 and "status" not in m01


def test_catalog_hides_drafts_and_version_follows_content(db_session):
    seed_items(db_session, get_vocab(), load_seed())
    with client_for(db_session) as client:
        before = client.get("/api/catalog").json()["catalogVersion"]
        db_session.add(Item(id="f-draft01", category="food", name="초안 메뉴", subtitle="1원", description="초안", tags=["담백함"],
                            emoji="🍽️", color="#ffffff", source="ai_draft"))
        db_session.commit()
        after_draft = client.get("/api/catalog").json()
        db_session.get(Item, "f01").description = "바뀐 설명"
        db_session.commit()
        after_edit = client.get("/api/catalog").json()["catalogVersion"]
    assert "f-draft01" not in {i["id"] for i in after_draft["items"]}
    assert after_draft["catalogVersion"] == before != after_edit


def test_published_drafts_round_trip_through_the_seed(db_session):
    seed_items(db_session, get_vocab(), load_seed())
    draft = {**load_seed()[16], "id": "m-0000abcd", "name": "새 곡", "artist": "새 가수", "subtitle": "새 가수", "source": "ai_draft"}
    seed_items(db_session, get_vocab(), [draft])
    published = published_items(db_session)["items"]
    assert [i["id"] for i in published] == ["m-0000abcd"] and published[0]["source"] == "ai_draft"
    db_session.execute(text("TRUNCATE items"))
    result = seed_items(db_session, get_vocab(), load_seed() + published)
    assert result.inserted == len(load_seed()) + 1
    assert db_session.get(Item, "m-0000abcd").source == "ai_draft"
    with pytest.raises(ValueError, match="출처"):
        seed_items(db_session, get_vocab(), [{**draft, "source": "web"}])

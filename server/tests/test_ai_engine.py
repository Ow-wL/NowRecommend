"""The AI engine behind POST /api/recommend for music (app/ai_engine.py, app/ai_items.py)."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.ai_engine import engine_for
from app.ai_items import AI_PICK_PREFIX, ai_item_id, is_ai_pick
from app.catalog import load_seed, refresh_embeddings, seed_items
from app.config import get_settings
from app.db import get_session
from app.drafting import export_review
from app.main import create_app
from app.models import Item, RecommendationLog
from app.retrieval.reasons import NO_TASTE_REASON
from app.routes.recommend import get_ai_engine_model, get_query_embedder, get_rerank_model
from app.schemas import RecommendRequest
from app.vocab import get_vocab
from tests.conftest import FakeEmbedder, needs_db


def test_engine_defaults_to_ai_except_favourites(monkeypatch):
    monkeypatch.setattr(get_settings(), "food_engine", "ai")
    assert engine_for(RecommendRequest(category="music")) == "ai"
    assert engine_for(RecommendRequest(category="food")) == "ai"
    assert engine_for(RecommendRequest(category="food", candidateIds=["f01"])) == "catalog"
    assert engine_for(RecommendRequest(category="food", engine="catalog")) == "catalog"
    assert engine_for(RecommendRequest(category="food", engine="ai")) == "ai"
    assert engine_for(RecommendRequest(category="music", engine="catalog")) == "catalog"
    assert engine_for(RecommendRequest(category="music", candidateIds=["m01"])) == "catalog"
    monkeypatch.setattr(get_settings(), "music_engine", "catalog")
    assert engine_for(RecommendRequest(category="music")) == "catalog"


def test_ai_item_ids_are_stable_and_recognisable():
    assert ai_item_id("music", "Spring Day", "BTS") == ai_item_id("music", "spring  day", "bts")
    assert ai_item_id("music", "A", "B") != ai_item_id("food", "A", "B")
    assert is_ai_pick(ai_item_id("music", "A", "B")) and not is_ai_pick("m01")
    assert RecommendRequest(category="music", seenIds=[ai_item_id("music", "A", "B")]).seenIds[0].startswith(AI_PICK_PREFIX)


def pick(name, detail="아티스트", taste="취향 이유", context="상황 이유", confidence="high", tags=("차분함",)):
    return {"name": name, "detail": detail, "tasteReason": taste, "contextReason": context, "confidence": confidence, "tags": list(tags)}


class FakeModel:
    model = "fake-llm"

    def __init__(self, answer):
        self.answer, self.payloads = answer, []

    def generate_json(self, system, payload, schema):
        self.payloads.append(payload)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


@pytest.fixture
def catalog(db_session):
    seed_items(db_session, get_vocab(), load_seed())
    refresh_embeddings(db_session, FakeEmbedder())
    return db_session


def client_for(session, model):
    app = create_app()
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_rerank_model] = lambda: None
    app.dependency_overrides[get_ai_engine_model] = lambda: model
    fake = FakeEmbedder()
    app.dependency_overrides[get_query_embedder] = lambda: (lambda text: fake.embed([text])[0])
    return TestClient(app)


def body(**overrides):
    return {"category": "music", "raw": "비 오는 밤 잔잔하게", "conditions": {"tags": ["차분함"], "excluded": []},
            "profile": {"selected": ["m01"], "tags": [], "disliked": ["m13"]}, **overrides}


@pytest.mark.db
@needs_db
def test_music_answers_come_from_the_model_and_are_persisted_as_items(catalog):
    model = FakeModel({"picks": [pick("밤편지", "아이유"), pick("Spring Day", "BTS", confidence="medium"), pick("Blue in Green", "Miles Davis", tags=["재즈", "연주곡"]),
                                 pick("새 곡", "새 가수"), pick("Spring Day", "bts"), pick("Nocturne", "Chopin", confidence="low")]})
    with client_for(catalog, model) as client:
        data = client.post("/api/recommend", json=body(seenIds=["m05"])).json()
    names = [r["item"]["name"] for r in data["results"]]
    # 밤편지 is the liked song (blocked), the second Spring Day is a duplicate; 5 picks were asked, 4 survive.
    assert names == ["Spring Day", "Blue in Green", "새 곡", "Nocturne"]
    assert data["meta"]["engine"] == "ai" and data["meta"]["ai"] == "used" and data["meta"]["mode"] == "rag" and data["meta"]["model"] == "fake-llm"
    assert [r["confidence"] for r in data["results"]] == ["medium", "high", "high", "low"]
    # Blue in Green is in the catalog (m11): the catalog item, with its cover, comes back instead of a new draft.
    by_name = {r["item"]["name"]: r["item"] for r in data["results"]}
    assert by_name["Blue in Green"]["id"] == "m11" and by_name["Spring Day"]["id"].startswith("ai-")
    assert by_name["Spring Day"]["subtitle"] == "BTS" and by_name["Spring Day"]["tags"] == ["차분함"]
    sent = model.payloads[0]
    assert sent["taste"]["liked"] == ["밤편지 - 아이유"] and sent["taste"]["disliked"] == ["좋은 날 - 아이유"] and sent["count"] == 5
    assert sent["avoid"] == ["봄날 - BTS"]  # the seen m05, as a label
    drafts = catalog.scalars(select(Item).where(Item.status == "draft")).all()
    assert {d.name for d in drafts} == {"Spring Day", "새 곡", "Nocturne"} and all(d.source == "ai_draft" for d in drafts)
    assert export_review(catalog)["items"] == []  # auto-saved picks are not review work
    log_entry = catalog.scalars(select(RecommendationLog)).one()
    assert log_entry.params["engine"] == "ai" and log_entry.mode == "rag" and log_entry.result_ids[0].startswith("ai-")
    # /api/catalog still lists reviewed items only.
    with client_for(catalog, model) as client:
        assert all(not i["id"].startswith("ai-") for i in client.get("/api/catalog?category=music").json()["items"])


@pytest.mark.db
@needs_db
def test_seen_and_pinned_ai_picks_resolve_to_labels_on_the_next_round(catalog):
    first = FakeModel({"picks": [pick("Spring Day", "BTS"), pick("Love poem", "아이유")]})
    with client_for(catalog, first) as client:
        shown = client.post("/api/recommend", json=body(count=2)).json()["results"]
    spring, love = shown[0]["item"]["id"], shown[1]["item"]["id"]
    second = FakeModel({"picks": [pick("Spring Day", "BTS"), pick("Through the Night", "IU"), pick("새 곡", "새 가수")]})
    with client_for(catalog, second) as client:
        data = client.post("/api/recommend", json=body(count=3, seenIds=[spring, love], pinnedIds=[love])).json()
    assert second.payloads[0]["avoid"] == ["Spring Day - BTS", "Love poem - 아이유"] and second.payloads[0]["count"] == 2
    names = [r["item"]["name"] for r in data["results"]]
    assert names == ["Love poem", "Through the Night", "새 곡"]  # pinned first; the repeated Spring Day was blocked
    assert data["results"][0]["contextReason"] == "고정한 곡이라 그대로 두었어요" and "confidence" not in data["results"][0]
    assert data["meta"]["newCount"] == 2


@pytest.mark.db
@needs_db
def test_model_failure_falls_back_to_the_catalog_pipeline(catalog):
    with client_for(catalog, FakeModel(TimeoutError("slow"))) as client:
        data = client.post("/api/recommend", json=body()).json()
    assert len(data["results"]) == 5 and all(not r["item"]["id"].startswith("ai-") for r in data["results"])
    expected = {"engine": "catalog", "engineWanted": "ai", "ai": "failed", "aiError": "TimeoutError", "mode": "retrieval_only"}
    assert {k: data["meta"][k] for k in expected} == expected
    with client_for(catalog, None) as client:
        off = client.post("/api/recommend", json=body()).json()
    assert off["meta"]["engine"] == "catalog" and off["meta"]["ai"] == "off"


@pytest.mark.db
@needs_db
def test_food_and_favourites_keep_the_catalog_engine(catalog):
    model = FakeModel({"picks": [pick("새 메뉴", "")]})
    with client_for(catalog, model) as client:
        food = client.post("/api/recommend", json={"category": "food", "raw": "담백한 저녁"}).json()
        saved = client.post("/api/recommend", json=body(candidateIds=["m01", "m02", "m03", "m04", "m05"])).json()
        forced = client.post("/api/recommend", json={"category": "food", "raw": "담백한 저녁", "engine": "ai", "count": 1}).json()
    assert food["meta"]["engine"] == "catalog" and saved["meta"]["engine"] == "catalog"
    assert len(model.payloads) == 1  # only the forced request reached the model
    assert forced["meta"]["engine"] == "ai" and forced["results"][0]["item"]["name"] == "새 메뉴" and forced["results"][0]["item"]["category"] == "food"


def food_pick(name, detail="BHC · 치킨", ingredients=(), base="치킨", confidence="high", broad=False):
    return {**pick(name, detail), "ingredients": list(ingredients), "baseDish": base, "broad": broad, "confidence": confidence}


def test_food_picks_name_detail_menus_and_lend_the_general_dish_photo(catalog):
    model = FakeModel({"picks": [food_pick("뿌링클", ingredients=["닭고기", "밀"]), food_pick("치킨 세트", detail="치킨", broad=True, base="없는 음식")]})
    with client_for(catalog, model) as client:
        answer = client.post("/api/recommend", json={"category": "food", "raw": "치킨 중에서 골라줘", "engine": "ai", "count": 2}).json()
    first, second = answer["results"]
    assert first["item"]["subtitle"] == "BHC · 치킨" and first["item"]["ingredients"] == ["닭고기", "밀"]
    assert first["item"]["parentId"] == "f13" and "broad" not in first
    assert second["broad"] is True and "parentId" not in second["item"]
    payload = model.payloads[0]
    assert "치킨" in payload["baseDishes"] and "유제품" in payload["ingredientWords"]


def test_a_pick_listing_an_excluded_ingredient_or_doubted_by_the_model_is_dropped(catalog):
    model = FakeModel({"picks": [food_pick("밀 든 메뉴", ingredients=["밀"]), food_pick("자신 없는 메뉴", confidence="low"), food_pick("해물 메뉴", ingredients=["해산물"]), food_pick("안전한 메뉴", ingredients=["닭고기"])]})
    with client_for(catalog, model) as client:
        answer = client.post("/api/recommend", json={"category": "food", "raw": "저녁", "engine": "ai", "conditions": {"excluded": ["밀", "해산물"]}}).json()
    assert [r["item"]["name"] for r in answer["results"]] == ["안전한 메뉴"]
    assert "excluded_value=3" in answer["meta"]["issues"]


def test_a_song_outside_the_years_or_without_one_is_dropped(catalog):
    model = FakeModel({"picks": [{**pick("옛 노래", "가수"), "releaseYear": 1995}, {**pick("새 노래", "가수2"), "releaseYear": 2021}, pick("모르는 해", "가수3")]})
    with client_for(catalog, model) as client:
        answer = client.post("/api/recommend", json={"category": "music", "raw": "90년대", "years": {"from": 1990, "to": 1999}, "count": 3}).json()
    assert [r["item"]["name"] for r in answer["results"]] == ["옛 노래"]
    assert answer["results"][0]["item"]["releaseYear"] == 1995
    assert model.payloads[0]["releaseYears"] == {"from": 1990, "to": 1999}
    assert "out_of_years=2" in answer["meta"]["issues"]


def test_reversed_years_are_refused(catalog):
    with client_for(catalog, FakeModel({"picks": []})) as client:
        assert client.post("/api/recommend", json={"category": "music", "years": {"from": 2000, "to": 1990}}).status_code == 422


def test_written_reasons_reach_the_model_and_a_typed_favourite_is_not_recommended_back(catalog):
    model = FakeModel({"picks": [pick("뿌링클", "BHC"), pick("황금올리브", "BBQ")]})
    profile = {"notes": ["치킨: 바삭해서", "뿌링클"], "customNames": ["뿌링클"]}
    with client_for(catalog, model) as client:
        answer = client.post("/api/recommend", json={"category": "food", "engine": "ai", "count": 2, "profile": profile}).json()
    assert model.payloads[0]["taste"]["likedText"] == ["치킨: 바삭해서", "뿌링클"]
    assert [r["item"]["name"] for r in answer["results"]] == ["황금올리브"]
    assert answer["results"][0]["tasteReason"] != NO_TASTE_REASON

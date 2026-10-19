import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.catalog import load_seed, refresh_embeddings, seed_items
from app.config import PROJECT_ROOT
from app.db import get_session
from app.main import create_app
from app.models import RecommendationLog
from app.retrieval.filters import eligible_query
from app.routes.recommend import get_query_embedder, get_rerank_model
from app.vocab import get_vocab
from tests.conftest import FakeEmbedder, needs_db

pytestmark = [pytest.mark.db, needs_db]
FILTER_CASES = json.loads((PROJECT_ROOT / "shared" / "filter-cases.json").read_text(encoding="utf-8"))["cases"]
TASTE = {"food": ["f01", "f02", "f07", "f09", "f12"], "music": ["m01", "m06", "m07", "m10", "m14"]}


@pytest.fixture
def catalog(db_session):
    seed_items(db_session, get_vocab(), load_seed())
    refresh_embeddings(db_session, FakeEmbedder())
    return db_session


def client_for(session, embedder="fake"):
    app = create_app()
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_rerank_model] = lambda: None  # retrieval only; rerank has its own tests
    fake = FakeEmbedder()
    app.dependency_overrides[get_query_embedder] = {
        "fake": lambda: (lambda text: fake.embed([text])[0]),
        "none": lambda: None,
        "broken": lambda: (lambda text: (_ for _ in ()).throw(TimeoutError("slow"))),
    }[embedder]
    return TestClient(app)


def body(category="food", **overrides):
    return {"category": category, "raw": "혼자 먹을 담백한 저녁", "conditions": {"tags": [], "excluded": [], "maxPrice": None},
            "profile": {"selected": TASTE[category], "tags": [], "disliked": []}, "tau": 0, **overrides}


@pytest.mark.parametrize("case", FILTER_CASES, ids=[c["name"] for c in FILTER_CASES])
def test_sql_filter_matches_frontend_cases(catalog, case):
    k = case["conditions"]
    query = eligible_query(case["category"], k["excluded"], k["maxPrice"], case["disliked"], case["excludedIds"], case["candidateIds"])
    assert sorted(r.id for r in catalog.scalars(query)) == case["expectedIds"]


@pytest.mark.parametrize("case", FILTER_CASES, ids=[c["name"] for c in FILTER_CASES])
def test_recommendations_never_break_hard_filters(catalog, case):
    request = body(case["category"], conditions=case["conditions"], profile={"selected": [], "tags": [], "disliked": case["disliked"]},
                   excludedIds=case["excludedIds"], candidateIds=case["candidateIds"], count=5)
    with client_for(catalog) as client:
        response = client.post("/api/recommend", json=request).json()
    ids = [r["item"]["id"] for r in response["results"]]
    assert set(ids) <= set(case["expectedIds"]) and len(ids) == min(5, len(case["expectedIds"]))
    assert response["meta"]["eligibleCount"] == len(case["expectedIds"])


def test_response_shape_and_template_reasons(catalog):
    with client_for(catalog) as client:
        food = client.post("/api/recommend", json=body(conditions={"tags": ["국물"], "excluded": [], "maxPrice": None})).json()
        music = client.post("/api/recommend", json=body("music", raw="")).json()
    assert len(food["results"]) == 3 and len(music["results"]) == 5
    assert food["meta"]["mode"] == "retrieval_only" and food["meta"]["contextSimilarity"] is True
    assert music["meta"]["catalogVersion"].startswith("db-")
    first = food["results"][0]
    assert set(first) == {"item", "tasteReason", "contextReason"} and "embedding" not in first["item"]
    for r in food["results"]:
        assert r["tasteReason"].endswith("가까워요") or r["tasteReason"] == "새로운 취향을 발견해보세요"
        assert ("국물" in r["contextReason"]) == ("국물" in r["item"]["tags"])
    assert all("price" not in r["item"] for r in music["results"])


def test_zero_temperature_is_repeatable(catalog):
    with client_for(catalog) as client:
        runs = [[r["item"]["id"] for r in client.post("/api/recommend", json=body()).json()["results"]] for _ in range(3)]
    assert runs[0] == runs[1] == runs[2]


def test_rerolls_show_unseen_candidates_until_exhausted(catalog):
    seen: list[str] = []
    with client_for(catalog) as client:
        for expected_new in (3, 3, 3, 3, 3, 1):
            meta_and_ids = client.post("/api/recommend", json=body(seenIds=seen, tau=0.05)).json()
            ids = [r["item"]["id"] for r in meta_and_ids["results"]]
            assert meta_and_ids["meta"]["newCount"] == expected_new
            assert len([i for i in ids if i not in seen]) == expected_new
            seen += [i for i in ids if i not in seen]
    assert len(seen) == 16


def test_pinned_cards_stay_first(catalog):
    with client_for(catalog) as client:
        ids = [r["item"]["id"] for r in client.post("/api/recommend", json=body(pinnedIds=["f16"], seenIds=["f16"])).json()["results"]]
    assert ids[0] == "f16" and len(ids) == 3


def test_works_without_and_despite_query_embedding(catalog):
    with client_for(catalog, "none") as client:
        without = client.post("/api/recommend", json=body()).json()
    with client_for(catalog, "broken") as client:
        broken = client.post("/api/recommend", json=body()).json()
    assert len(without["results"]) == len(broken["results"]) == 3
    assert without["meta"]["contextSimilarity"] is broken["meta"]["contextSimilarity"] is False
    entry = catalog.scalars(select(RecommendationLog).order_by(RecommendationLog.created_at.desc())).first()
    assert entry.error == "query_embedding:TimeoutError"


def test_each_request_is_logged(catalog):
    with client_for(catalog) as client:
        meta = client.post("/api/recommend", json=body()).json()["meta"]
    entry = catalog.get(RecommendationLog, __import__("uuid").UUID(meta["requestId"]))
    assert entry.mode == "retrieval_only" and entry.raw_text == "혼자 먹을 담백한 저녁"
    assert entry.result_ids == entry.candidate_ids[:3] and len(entry.candidate_ids) == 10
    assert set(entry.candidate_scores[entry.result_ids[0]]) >= {"score", "context", "taste"}
    assert entry.params["selection"]["tau"] == 0


@pytest.mark.parametrize("change", [
    {"conditions": {"tags": ["없는태그"], "excluded": [], "maxPrice": None}},
    {"conditions": {"tags": [], "excluded": ["보컬"], "maxPrice": None}},  # music-only exclusion on food
    {"conditions": {"tags": [], "excluded": [], "maxPrice": 50}},
    {"count": 6}, {"raw": "가" * 301}, {"excludedIds": ["../etc"]}, {"tau": 2},
])
def test_invalid_requests_are_rejected(catalog, change):
    with client_for(catalog) as client:
        assert client.post("/api/recommend", json=body(**change)).status_code == 422

import uuid

import pytest
from fastapi.testclient import TestClient

from app.catalog import load_seed, refresh_embeddings, seed_items
from app.db import get_session
from app.main import create_app
from app.models import RecommendationLog
from app.routes.recommend import get_query_embedder, get_rerank_model
from app.vocab import get_vocab
from tests.conftest import FakeEmbedder, needs_db

pytestmark = [pytest.mark.db, needs_db]


class FakeModel:
    """Answers with `choose(payload)`; records every payload the pipeline sends."""

    model = "fake-llm"

    def __init__(self, choose):
        self.choose, self.payloads = choose, []

    def generate_json(self, system, payload, schema):
        self.payloads.append(payload)
        return self.choose(payload)


def reverse_order(payload):
    return {"picks": [{"id": c["id"], "tasteReason": f"AI가 본 취향 {c['name']}", "contextReason": "AI가 본 상황"}
                      for c in reversed(payload["candidates"])][: payload["count"]]}


@pytest.fixture
def catalog(db_session):
    seed_items(db_session, get_vocab(), load_seed())
    refresh_embeddings(db_session, FakeEmbedder())
    return db_session


def client_for(session, model):
    app = create_app()
    fake = FakeEmbedder()
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_query_embedder] = lambda: (lambda text: fake.embed([text])[0])
    app.dependency_overrides[get_rerank_model] = lambda: model
    return TestClient(app)


def body(**overrides):
    return {"category": "food", "raw": "비 오는 날 얼큰한 국물", "conditions": {"tags": ["국물"], "excluded": ["밀"]},
            "profile": {"selected": ["f04", "f08"], "tags": [], "disliked": []}, "tau": 0, **overrides}


def post(session, model, **overrides):
    with client_for(session, model) as client:
        response = client.post("/api/recommend", json=body(**overrides))
    assert response.status_code == 200
    return response.json()


def ids(response):
    return [r["item"]["id"] for r in response["results"]]


def log_for(session, response):
    return session.get(RecommendationLog, uuid.UUID(response["meta"]["requestId"]))


def test_model_order_and_reasons_are_used(catalog):
    model = FakeModel(reverse_order)
    response = post(catalog, model)
    candidates = [c["id"] for c in model.payloads[0]["candidates"]]
    assert response["meta"]["mode"] == "rag" and response["meta"]["ai"] == "used" and response["meta"]["situational"] is True
    assert ids(response) == list(reversed(candidates))[:3]
    assert response["results"][0]["contextReason"] == "AI가 본 상황"
    entry = log_for(catalog, response)
    assert entry.mode == "rag" and entry.params["rerankModel"] == "fake-llm" and entry.params["aiPicks"] == 3


def test_model_sees_only_filtered_candidates_and_cannot_add_others(catalog):
    model = FakeModel(lambda p: {"picks": [{"id": "f01", "tasteReason": "x", "contextReason": "y"}]})  # 쌀국수 has 밀
    response = post(catalog, model)
    payload = model.payloads[0]
    assert "f01" not in {c["id"] for c in payload["candidates"]}
    assert all("밀" not in c.get("ingredients", []) for c in payload["candidates"])
    assert payload["situation"] == "비 오는 날 얼큰한 국물" and payload["count"] == 3 and payload["excluded"] == ["밀"]
    assert response["meta"]["mode"] == "retrieval_only" and "f01" not in ids(response)
    assert log_for(catalog, response).error == "rerank:no_valid_picks"


def test_model_failure_falls_back_to_retrieval(catalog):
    def boom(payload):
        raise TimeoutError("slow")
    failed = post(catalog, FakeModel(boom))
    without = post(catalog, None)
    assert failed["meta"]["mode"] == without["meta"]["mode"] == "retrieval_only"
    assert (failed["meta"]["ai"], without["meta"]["ai"]) == ("failed", "off")
    assert ids(failed) == ids(without)
    assert log_for(catalog, failed).error == "rerank:TimeoutError"


def test_partial_answers_are_filled_and_logged(catalog):
    model = FakeModel(lambda p: {"picks": [{"id": p["candidates"][-1]["id"], "tasteReason": "AI", "contextReason": "AI"}, {"id": "zz"}]})
    response = post(catalog, model)
    assert response["meta"]["mode"] == "rag" and len(response["results"]) == 3
    assert response["results"][0]["tasteReason"] == "AI"
    assert log_for(catalog, response).error == "rerank:filled=2,unknown_id=1"


def test_model_only_sees_unseen_candidates_while_enough_remain(catalog):
    seen = ["f02"]  # without 밀 only f02·f03·f04·f16 are eligible, so three unseen remain
    model = FakeModel(reverse_order)
    response = post(catalog, model, seenIds=seen)
    assert not {c["id"] for c in model.payloads[0]["candidates"]} & set(seen)
    assert response["meta"]["newCount"] == 3


def test_remaining_unseen_cards_are_required_when_too_few(catalog):
    eligible_without_wheat = ["f02", "f03", "f04", "f16"]
    seen = eligible_without_wheat[:-1]  # only f16 is unseen
    model = FakeModel(lambda p: {"picks": [{"id": i, "tasteReason": "AI", "contextReason": "AI"} for i in ["f02", "f03", "f04"]]})
    response = post(catalog, model, seenIds=seen)
    assert "f16" in ids(response) and len(ids(response)) == 3
    assert response["meta"]["newCount"] == 1


def test_pinned_card_stays_first_with_the_model(catalog):
    response = post(catalog, FakeModel(reverse_order), pinnedIds=["f16"])
    assert ids(response)[0] == "f16" and response["meta"]["mode"] == "rag"


def test_taste_claims_about_unpicked_artists_are_replaced(catalog):
    def claim(payload):
        first = payload["candidates"][0]
        return {"picks": [{"id": first["id"], "tasteReason": "평소 좋아하는 BTS 곡 스타일이에요", "contextReason": "AI 상황"}]}
    request = {"category": "music", "raw": "신나게 달리기", "conditions": {"tags": ["운동"], "excluded": []},
               "profile": {"selected": ["m06", "m07", "m10", "m11", "m12"], "tags": [], "disliked": []}, "tau": 0}
    with client_for(catalog, FakeModel(claim)) as client:
        response = client.post("/api/recommend", json=request).json()
    assert "BTS" not in response["results"][0]["tasteReason"] and response["results"][0]["contextReason"] == "AI 상황"
    assert "taste_claim=1" in log_for(catalog, response).error


def test_the_model_never_sees_prices_or_price_words(catalog):
    model = FakeModel(reverse_order)
    response = post(catalog, model, raw="만원 이하로 얼큰한 국물, 배달 가능한 곳")
    payload = model.payloads[0]
    assert payload["situation"] == "로 얼큰한 국물, 곳" and "maxPrice" not in payload
    assert all("price" not in c for c in payload["candidates"])
    assert response["meta"]["mode"] == "rag"


def test_extra_registered_items_are_kept_from_the_model(catalog):
    model = FakeModel(reverse_order)
    post(catalog, model, conditions={"tags": [], "excluded": []}, profile={"selected": ["f02", "f03", "f04", "f16", "f01"], "tags": [], "disliked": []})
    shown = [c["id"] for c in model.payloads[0]["candidates"]]
    assert len([i for i in shown if i in {"f02", "f03", "f04", "f16", "f01"}]) <= 1

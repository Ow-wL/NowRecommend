import pytest
from fastapi.testclient import TestClient

from app.catalog import load_seed, seed_items
from app.db import get_session
from app.llm.free import song_key, validate_free
from app.main import create_app
from app.routes.lab import get_free_models
from app.vocab import get_vocab
from tests.conftest import needs_db


def pick(title, artist="아티스트", taste="취향 이유", context="상황 이유", confidence="high"):
    return {"title": title, "artist": artist, "tasteReason": taste, "contextReason": context, "confidence": confidence}


def test_song_key_ignores_case_spacing_and_quotes():
    assert song_key("One Summer’s Day", "히사이시 조") == song_key("one summers day", "히사이시조")


def test_validate_free_drops_duplicates_blocked_and_incomplete_picks():
    raw = [pick("A"), pick("a "), pick("B", taste=""), "junk", pick("밤편지", "아이유"), pick("C"), pick("D")]
    result = validate_free(raw, 5, ["밤편지 - 아이유"])
    assert [p.title for p in result.picks] == ["A", "C", "D"]
    assert result.issues == {"duplicate": 1, "incomplete": 1, "malformed": 1, "blocked": 1, "short": 2}


def test_validate_free_blocks_a_bare_title_by_any_artist_and_trims_extra():
    result = validate_free([pick("Hype Boy", "NewJeans"), pick("X"), pick("Y"), pick("Z")], 2, ["Hype Boy"])
    assert [p.title for p in result.picks] == ["X", "Y"]
    assert result.issues == {"blocked": 1, "extra": 1}


def test_validate_free_unescapes_html_entities():
    result = validate_free([pick("Gymnop&eacute;die No. 1", "Erik Satie", taste="잔잔한 &amp; 차분한")], 1, [])
    assert result.picks[0].title == "Gymnopédie No. 1" and result.picks[0].taste_reason == "잔잔한 & 차분한"


def test_validate_free_cuts_long_reasons_and_defaults_unknown_confidence_to_low():
    result = validate_free([pick("A", context="가" * 80, confidence="sure")], 1, [])
    assert len(result.picks[0].context_reason) == 50 and result.picks[0].confidence == "low"


class FakeModel:
    model = "fake-llm"

    def __init__(self, answer):
        self.answer, self.payloads = answer, []

    def generate_json(self, system, payload, schema):
        self.payloads.append(payload)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def client_for(session, model):
    app = create_app()
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_free_models] = lambda: {} if model is None else {model.model: model}
    return TestClient(app)


@pytest.fixture
def catalog(db_session):
    seed_items(db_session, get_vocab(), load_seed())
    return db_session


@pytest.mark.db
@needs_db
def test_free_route_sends_song_names_and_blocks_liked_and_disliked(catalog):
    model = FakeModel({"picks": [pick("밤편지", "아이유"), pick("Hype Boy", "NewJeans"), pick("Ditto", "NewJeans"), pick("새 곡", "새 가수")]})
    body = {"raw": "비 오는 밤", "conditions": {"tags": ["차분함"], "excluded": ["보컬"]},
            "profile": {"selected": ["m01"], "tags": ["발라드"], "disliked": ["m03"]}, "likedText": ["검정치마"], "avoid": ["새 곡 - 새 가수"], "count": 3}
    with client_for(catalog, model) as client:
        response = client.post("/api/lab/music/free", json=body)
    assert response.status_code == 200
    data = response.json()
    assert [r["title"] for r in data["results"]] == ["Ditto"]
    assert data["meta"]["ai"] == "used" and data["meta"]["mode"] == "free"
    sent = model.payloads[0]
    assert sent["taste"] == {"likedSongs": ["밤편지 - 아이유"], "likedTags": ["발라드"], "likedText": ["검정치마"], "disliked": ["Hype Boy - NewJeans"]}
    assert sent["excluded"] == ["보컬"] and sent["count"] == 3


@pytest.mark.db
@needs_db
def test_free_route_reports_failure_without_results(catalog):
    with client_for(catalog, FakeModel(TimeoutError("slow"))) as client:
        data = client.post("/api/lab/music/free", json={"raw": "산책"}).json()
    assert data["results"] == [] and data["meta"]["ai"] == "failed" and data["meta"]["issues"] == "TimeoutError"
    with client_for(catalog, None) as client:
        assert client.post("/api/lab/music/free", json={"raw": "산책"}).json()["meta"]["ai"] == "off"


@pytest.mark.db
@needs_db
def test_free_route_rejects_unknown_conditions(catalog):
    with client_for(catalog, FakeModel({"picks": []})) as client:
        assert client.post("/api/lab/music/free", json={"conditions": {"tags": ["매콤함"]}}).status_code == 422


@pytest.mark.db
@needs_db
def test_free_route_uses_the_requested_lab_model_only(catalog):
    lite, flash = FakeModel({"picks": [pick("A")]}), FakeModel({"picks": [pick("B")]})
    lite.model, flash.model = "lite", "flash"
    app = create_app()
    app.dependency_overrides[get_session] = lambda: catalog
    app.dependency_overrides[get_free_models] = lambda: {"lite": lite, "flash": flash}
    with TestClient(app) as client:
        assert client.get("/api/lab/music/models").json() == {"models": ["lite", "flash"]}
        assert client.post("/api/lab/music/free", json={"count": 1}).json()["meta"]["model"] == "lite"
        answer = client.post("/api/lab/music/free", json={"count": 1, "model": "flash"}).json()
        assert answer["results"][0]["title"] == "B" and answer["meta"]["model"] == "flash"
        assert client.post("/api/lab/music/free", json={"model": "gpt"}).status_code == 422

import pytest
from fastapi.testclient import TestClient

from app.catalog import load_seed, seed_items
from app.db import get_session
from app.llm.free import pick_key, validate_free
from app.main import create_app
from app.routes.lab import DailyCap, get_daily_cap, get_free_models
from app.vocab import get_vocab
from tests.conftest import needs_db


def pick(name, detail="아티스트", taste="취향 이유", context="상황 이유", confidence="high", tags=()):
    return {"name": name, "detail": detail, "tasteReason": taste, "contextReason": context, "confidence": confidence, "tags": list(tags)}


def test_pick_key_ignores_case_spacing_and_quotes():
    assert pick_key("One Summer’s Day", "히사이시 조") == pick_key("one summers day", "히사이시조")


def test_validate_free_drops_duplicates_blocked_and_incomplete_picks():
    raw = [pick("A"), pick("a "), pick("B", taste=""), "junk", pick("밤편지", "아이유"), pick("C"), pick("D")]
    result = validate_free(raw, 5, ["밤편지 - 아이유"])
    assert [p.name for p in result.picks] == ["A", "C", "D"]
    assert result.issues == {"duplicate": 1, "incomplete": 1, "malformed": 1, "blocked": 1, "short": 2}


def test_validate_free_blocks_a_bare_name_by_any_detail_and_trims_extra():
    result = validate_free([pick("Hype Boy", "NewJeans"), pick("X"), pick("Y"), pick("Z")], 2, ["Hype Boy"])
    assert [p.name for p in result.picks] == ["X", "Y"]
    assert result.issues == {"blocked": 1, "extra": 1}


def test_validate_free_still_reads_the_old_title_artist_shape():
    result = validate_free([{"title": "밤편지", "artist": "아이유", "tasteReason": "a", "contextReason": "b", "confidence": "high"}], 1, [])
    assert (result.picks[0].name, result.picks[0].detail, result.picks[0].label) == ("밤편지", "아이유", "밤편지 - 아이유")


def test_validate_free_unescapes_html_entities():
    result = validate_free([pick("Gymnop&eacute;die No. 1", "Erik Satie", taste="잔잔한 &amp; 차분한")], 1, [])
    assert result.picks[0].name == "Gymnopédie No. 1" and result.picks[0].taste_reason == "잔잔한 & 차분한"


def test_validate_free_cuts_long_reasons_and_defaults_unknown_confidence_to_low():
    result = validate_free([pick("A", context="가" * 80, confidence="sure")], 1, [])
    assert len(result.picks[0].context_reason) == 50 and result.picks[0].confidence == "low"


def test_validate_free_keeps_only_allowed_tags_and_reports_the_rest():
    result = validate_free([pick("A", tags=["차분함", "매콤함", "차분함", 3])], 1, [], allowed_tags=["차분함", "보컬"])
    assert result.picks[0].tags == ["차분함"] and result.issues == {"unknown_tag": 1}


def test_food_picks_need_no_detail_and_dedupe_by_name():
    raw = [pick("비빔국수", "분식 · 면"), pick("비빔국수", ""), pick("콩국수", "")]
    result = validate_free(raw, 3, ["콩국수"], detail_required=False)
    assert [p.name for p in result.picks] == ["비빔국수"] and result.issues == {"duplicate": 1, "blocked": 1, "short": 2}
    assert validate_free([pick("A", "")], 1, []).issues == {"incomplete": 1, "short": 1}  # music keeps needing the artist


class FakeModel:
    model = "fake-llm"

    def __init__(self, answer):
        self.answer, self.payloads, self.systems = answer, [], []

    def generate_json(self, system, payload, schema):
        self.payloads.append(payload)
        self.systems.append(system)
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
    model = FakeModel({"picks": [pick("밤편지", "아이유"), pick("Hype Boy", "NewJeans"), pick("Ditto", "NewJeans", tags=["팝", "활기참"]), pick("새 곡", "새 가수")]})
    body = {"raw": "비 오는 밤", "conditions": {"tags": ["차분함"], "excluded": ["보컬"]},
            "profile": {"selected": ["m01"], "tags": ["발라드"], "disliked": ["m03"]}, "likedText": ["검정치마"], "avoid": ["새 곡 - 새 가수"], "count": 3}
    with client_for(catalog, model) as client:
        response = client.post("/api/lab/music/free", json=body)
    assert response.status_code == 200
    data = response.json()
    assert [r["name"] for r in data["results"]] == ["Ditto"]
    assert data["results"][0]["item"]["id"].startswith("ai-") and data["results"][0]["item"]["tags"] == ["팝", "활기참"]
    assert data["meta"]["ai"] == "used" and data["meta"]["mode"] == "free" and data["meta"]["category"] == "music"
    sent = model.payloads[0]
    assert sent["taste"] == {"liked": ["밤편지 - 아이유"], "likedTags": ["발라드"], "likedText": ["검정치마"], "disliked": ["Hype Boy - NewJeans"]}
    assert sent["excluded"] == ["보컬"] and sent["count"] == 3 and "차분함" in sent["allowedTags"]
    assert "음악 큐레이터" in model.systems[0]


@pytest.mark.db
@needs_db
def test_food_free_route_uses_the_food_prompt_and_vocabulary(catalog):
    model = FakeModel({"picks": [pick("들기름 막국수", "한식 · 차가운 면", tags=["담백함", "차가움", "한식"]), pick("쌀국수", "")]})
    body = {"raw": "더운 날 가볍게", "conditions": {"tags": ["차가움"], "excluded": ["유제품"]}, "profile": {"selected": ["f01"], "tags": [], "disliked": []}, "count": 2}
    with client_for(catalog, model) as client:
        data = client.post("/api/lab/food/free", json=body).json()
        assert client.post("/api/lab/food/free", json={"conditions": {"tags": ["보컬"]}}).status_code == 422
    assert [r["name"] for r in data["results"]] == ["들기름 막국수"]  # 쌀국수 is the liked f01 → blocked
    assert data["results"][0]["item"]["subtitle"] == "한식 · 차가운 면"
    assert "메뉴 큐레이터" in model.systems[0] and model.payloads[0]["taste"]["liked"] == ["쌀국수"]


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
        assert client.get("/api/lab/models").json() == {"models": ["lite", "flash"]}
        assert client.get("/api/lab/music/models").json() == {"models": ["lite", "flash"]}
        assert client.post("/api/lab/music/free", json={"count": 1}).json()["meta"]["model"] == "lite"
        answer = client.post("/api/lab/music/free", json={"count": 1, "model": "flash"}).json()
        assert answer["results"][0]["name"] == "B" and answer["meta"]["model"] == "flash"
        assert client.post("/api/lab/music/free", json={"model": "gpt"}).status_code == 422


def test_daily_cap_resets_each_day():
    day = ["2026-10-26"]
    cap = DailyCap(today=lambda: day[0])
    assert [cap.take("flash", 2) for _ in range(3)] == [True, True, False]
    assert cap.take("lite", 2)
    day[0] = "2026-10-27"
    assert cap.take("flash", 2)
    assert all(cap.take("free", 0) for _ in range(50))


@pytest.mark.db
@needs_db
def test_extra_lab_models_stop_at_the_daily_cap_and_filtered_answers_count_as_used(catalog):
    lite, flash = FakeModel({"picks": [pick("밤편지", "아이유")]}), FakeModel({"picks": [pick("B")]})
    lite.model, flash.model = "lite", "flash"
    app = create_app()
    app.dependency_overrides[get_session] = lambda: catalog
    app.dependency_overrides[get_free_models] = lambda: {"lite": lite, "flash": flash}
    cap = DailyCap()
    app.dependency_overrides[get_daily_cap] = lambda: cap
    with TestClient(app) as client:
        cap.counts["flash"], cap.day = 10, cap.today()
        refused = client.post("/api/lab/music/free", json={"count": 1, "model": "flash"}).json()
        assert refused["meta"]["issues"] == "daily_limit" and refused["results"] == [] and flash.payloads == []
        # The default model has no cap; an answer whose every pick is blocked is still a model answer.
        blocked = client.post("/api/lab/music/free", json={"count": 1, "avoid": ["밤편지 - 아이유"]}).json()
        assert blocked["meta"]["ai"] == "used" and blocked["results"] == [] and "blocked=1" in blocked["meta"]["issues"]


def test_long_avoid_labels_fit_the_name_limit():
    from app.routes.lab import FreeRequest
    label = f"{'가' * 80} - {'나' * 80}"
    assert FreeRequest(avoid=[label]).avoid == [label]

import json

import pytest
from fastapi.testclient import TestClient

from app.config import PROJECT_ROOT
from app.main import create_app
from app.parsing.ai import AiParse, ai_parse, merge
from app.parsing.coverage import uncovered_words
from app.parsing.rules import parse_rules
from app.parsing.service import ParseService
from app.routes.parse import get_parse_model, get_parse_service
from app.vocab import get_vocab

CASES = json.loads((PROJECT_ROOT / "shared" / "parse-cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[f"{c['category']}:{c['text'] or '-'}" for c in CASES])
def test_rules_match_the_frontend_parser(case):
    assert parse_rules(case["text"], case["category"]).conditions() == case["expected"]


@pytest.mark.parametrize("text, category, expected", [
    ("혼자 먹을 담백한 저녁이 먹고 싶어", "food", []),
    ("과제하면서 들을 적당히 활기찬 음악을 추천해줘", "music", []),
    ("유제품 없이 담백하게", "food", []),
    ("1만 5천원 이하로 저녁", "food", []),
    ("공부할 때 차분한 거, 만원", "music", []),  # music ignores budgets, so the amount is not "missed"
    ("그냥 아무거나", "food", []),
    ("속이 안 좋아서 부담 없는 걸로", "food", ["좋아서"]),
    ("3만원으로 기념일 저녁", "food", ["기념일"]),
    ("비 오는 밤 혼자 듣기 좋은 노래", "music", ["혼자"]),  # 혼자 is a food tag only
    ("밀가루 못 먹어요, 점심 추천", "food", []),
    ("고기 없이 먹고 싶어, 소고기 돼지고기 닭고기 다 빼고", "food", []),  # the whole listed span is covered
    ("비건이라 고기 생선 달걀 유제품 다 빼줘", "food", ["비건이라"]),
    ("팝 말고 차분한 노래", "music", []),
])
def test_uncovered_words(text, category, expected):
    assert uncovered_words(text, parse_rules(text, category).spans) == expected


class Model:
    model = "fake"

    def __init__(self, answer=None, error=None):
        self.answer, self.error, self.calls = answer, error, []

    def generate_json(self, system, payload, schema):
        self.calls.append(payload)
        if self.error:
            raise self.error
        return self.answer


def test_ai_answers_are_limited_to_the_vocabulary_and_the_sentence():
    vocab = get_vocab().food
    model = Model({"wanted": ["따뜻함", "따뜻함", "없는태그", "한식"], "excluded": ["매콤함", "새우"], "maxPrice": 9000,
                   "unparsed": ["속이 안 좋아서", "지어낸 표현", "  ", "속이 안 좋아서"]})
    result = ai_parse(model, "food", "속이 안 좋아서 부담 없는 걸로", vocab, {"tags": [], "excluded": [], "maxPrice": None}, ["좋아서"])
    assert result == AiParse(["따뜻함"], ["매콤함"], None, ["속이 안 좋아서"])  # no amount in the sentence → no budget
    assert model.calls[0]["wordsRulesMissed"] == ["좋아서"] and model.calls[0]["allowedTags"] == vocab.conditionTags


def test_ai_budget_needs_food_and_an_amount_in_the_sentence():
    answer = {"wanted": [], "excluded": [], "maxPrice": 12000, "unparsed": []}
    assert ai_parse(Model(answer), "food", "만 이천원 정도로 기념일", get_vocab().food, {"tags": [], "excluded": [], "maxPrice": None}, ["기념일"]).max_price == 12000
    assert ai_parse(Model(answer), "music", "만 이천원", get_vocab().music, {"tags": [], "excluded": [], "maxPrice": None}, ["x"]).max_price is None
    assert ai_parse(Model({**answer, "maxPrice": 0}), "food", "3만원", get_vocab().food, {"tags": [], "excluded": [], "maxPrice": None}, ["x"]).max_price is None


def test_merge_unions_exclusions_and_keeps_the_rule_budget():
    rule = {"tags": ["점심", "매콤함"], "excluded": ["밀"], "maxPrice": 10000}
    merged = merge(rule, AiParse(["채소", "점심"], ["매콤함"], 20000, []))
    assert merged == {"tags": ["점심", "채소"], "excluded": ["밀", "매콤함"], "maxPrice": 10000}
    assert merge({**rule, "maxPrice": None}, AiParse([], [], 20000, []))["maxPrice"] == 20000


def test_service_calls_the_model_only_for_missed_words_and_caches():
    service, model = ParseService(), Model({"wanted": ["따뜻함"], "excluded": [], "maxPrice": 0, "unparsed": []})
    covered = service.parse("food", "혼자 먹을 담백한 저녁", get_vocab(), model)
    assert covered["source"] == "rule" and covered["ai"] == "not_needed" and model.calls == []
    first = service.parse("food", "속이 안 좋아서 부담 없는 걸로", get_vocab(), model)
    again = service.parse("food", "속이  안 좋아서 부담 없는 걸로", get_vocab(), model)  # same words, extra space
    assert first == again and len(model.calls) == 1
    assert first["source"] == "rule+ai" and first["conditions"]["tags"] == ["담백함", "따뜻함"]


def test_service_failures_keep_rules_and_are_retried():
    service = ParseService()
    failing = Model(error=TimeoutError("slow"))
    first = service.parse("food", "3만원으로 기념일 저녁", get_vocab(), failing)
    assert first == {"conditions": {"tags": ["저녁"], "excluded": [], "maxPrice": 30000}, "unparsed": ["기념일"], "source": "rule", "ai": "failed"}
    service.parse("food", "3만원으로 기념일 저녁", get_vocab(), failing)
    assert len(failing.calls) == 2
    assert service.parse("music", "비 오는 밤 혼자", get_vocab(), None)["ai"] == "unavailable"


def test_parse_route():
    app = create_app()
    model = Model({"wanted": ["차분함", "휴식"], "excluded": [], "maxPrice": 0, "unparsed": []})
    app.dependency_overrides[get_parse_model] = lambda: model
    app.dependency_overrides[get_parse_service] = ParseService
    with TestClient(app) as client:
        ok = client.post("/api/parse", json={"category": "music", "text": "비 오는 밤 혼자 듣기 좋은 노래"})
        assert client.post("/api/parse", json={"category": "drink", "text": "x"}).status_code == 422
        assert client.post("/api/parse", json={"category": "food", "text": "가" * 301}).status_code == 422
    assert ok.json() == {"conditions": {"tags": ["차분함", "휴식"], "excluded": [], "maxPrice": None}, "unparsed": [], "source": "rule+ai", "ai": "used"}

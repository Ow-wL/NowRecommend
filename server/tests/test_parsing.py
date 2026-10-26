import json

import pytest
from fastapi.testclient import TestClient

from app.config import PROJECT_ROOT
from app.main import create_app
from app.parsing.ai import AiParse, ai_parse, merge
from app.parsing.coverage import uncovered_words
from app.parsing.rules import parse_rules, situation_text
from app.parsing.service import ParseService
from app.routes.parse import get_parse_model, get_parse_service
from app.vocab import get_vocab

CASES = json.loads((PROJECT_ROOT / "shared" / "parse-cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[f"{c['category']}:{c['text'] or '-'}" for c in CASES])
def test_rules_match_the_frontend_parser(case):
    result = parse_rules(case["text"], case["category"])
    assert result.conditions() == {"tags": case["expected"]["tags"], "excluded": case["expected"]["excluded"]}
    assert result.unsupported == case["expected"]["unsupported"]


def test_unsupported_phrases_never_steer_ranking():
    sentence = "혼자 먹을 만원 이하 저녁, 해산물은 빼고 맵지 않게, 배달 가능한 메뉴"
    assert situation_text(sentence, "food") == "혼자 먹을 저녁, 해산물은 빼고 맵지 않게, 메뉴"
    assert situation_text("공부할 때 차분한 거, 만원", "music") == "공부할 때 차분한 거,"


@pytest.mark.parametrize("text, category, expected", [
    ("혼자 먹을 담백한 저녁이 먹고 싶어", "food", []),
    ("과제하면서 들을 적당히 활기찬 음악을 추천해줘", "music", []),
    ("유제품 없이 담백하게", "food", []),
    ("1만 5천원 이하로 저녁", "food", []),  # price is unsupported: understood (to say so), never sent to the model
    ("배달 가능한 매콤한 거, 근처에서", "food", []),
    ("공부할 때 차분한 거, 만원", "music", []),  # music has no price either, so the amount is not "missed"
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
                   "unparsed": ["속이 안 좋아서", "지어낸 표현", "  ", "속이 안 좋아서"]})  # a stray budget is ignored
    result = ai_parse(model, "food", "속이 안 좋아서 부담 없는 걸로", vocab, {"tags": [], "excluded": []}, ["좋아서"])
    assert result == AiParse(["따뜻함"], ["매콤함"], ["속이 안 좋아서"])
    assert model.calls[0]["wordsRulesMissed"] == ["좋아서"] and model.calls[0]["allowedTags"] == vocab.conditionTags


def test_the_model_is_told_price_and_delivery_are_unsupported():
    from app.parsing.ai import SYSTEM, response_schema
    assert "maxPrice" not in response_schema(get_vocab().food)["properties"]
    assert "가격·예산·배달" in SYSTEM


def test_merge_unions_exclusions_and_has_no_budget():
    rule = {"tags": ["점심", "매콤함"], "excluded": ["밀"]}
    merged = merge(rule, AiParse(["채소", "점심"], ["매콤함"], []), "밀 빼고 안 매운 점심", "food")
    assert merged == {"tags": ["점심", "채소"], "excluded": ["밀", "매콤함"]}


def test_merge_drops_music_exclusions_the_sentence_does_not_ask_for():
    rule = {"tags": ["활기참"], "excluded": []}
    # Lite once excluded the genre that was asked for.
    assert merge(rule, AiParse(["높은 에너지"], ["록"], []), "에너지 넘치는 록", "music")["excluded"] == []
    assert merge(rule, AiParse(["록"], ["록"], []), "록 말고 신나는 거", "music")["excluded"] == []
    assert merge(rule, AiParse([], ["피아노"], []), "신나는 거, 피아노 말고", "music")["excluded"] == ["피아노"]


@pytest.mark.parametrize("sentence, excluded", [
    ("땅콩 알러지 있어", ["땅콩"]), ("유당불내증 있어요", ["유제품"]), ("고기 안 들어간 걸로", ["소고기", "돼지고기", "닭고기"]),
    ("우유 들어가면 안 돼", ["유제품"]), ("글루텐 프리로", ["밀"]), ("돼지고기 금지", ["돼지고기"]), ("비건 메뉴", ["소고기"]),
])
def test_merge_keeps_food_exclusions_the_rules_missed(sentence, excluded):
    # An allergy or diet the model caught must never be dropped (review 2026-10-26 found this regression).
    empty = {"tags": [], "excluded": []}
    assert merge(empty, AiParse([], excluded, []), sentence, "food")["excluded"] == excluded


def test_merge_lets_a_food_exclusion_win_over_a_wanted_tag():
    rule = {"tags": ["매콤함"], "excluded": []}
    assert merge(rule, AiParse([], ["매콤함"], []), "맵지 않은 거", "food") == {"tags": [], "excluded": ["매콤함"]}


def test_service_calls_the_model_only_for_missed_words_and_caches():
    service, model = ParseService(), Model({"wanted": ["따뜻함"], "excluded": [], "unparsed": []})
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
    assert first == {"conditions": {"tags": ["저녁"], "excluded": []}, "unparsed": ["기념일"], "unsupported": [{"kind": "price", "text": "3만원"}],
                     "source": "rule", "ai": "failed"}
    service.parse("food", "3만원으로 기념일 저녁", get_vocab(), failing)
    assert len(failing.calls) == 2
    assert service.parse("music", "비 오는 밤 혼자", get_vocab(), None)["ai"] == "unavailable"


def test_parse_route():
    app = create_app()
    model = Model({"wanted": ["차분함", "휴식"], "excluded": [], "unparsed": []})
    app.dependency_overrides[get_parse_model] = lambda: model
    app.dependency_overrides[get_parse_service] = ParseService
    with TestClient(app) as client:
        ok = client.post("/api/parse", json={"category": "music", "text": "비 오는 밤 혼자 듣기 좋은 노래"})
        assert client.post("/api/parse", json={"category": "drink", "text": "x"}).status_code == 422
        assert client.post("/api/parse", json={"category": "food", "text": "가" * 301}).status_code == 422
    assert ok.json() == {"conditions": {"tags": ["차분함", "휴식"], "excluded": []}, "unparsed": [], "unsupported": [], "source": "rule+ai", "ai": "used"}


def test_the_model_cannot_bring_back_a_tag_the_sentence_left_out():
    # "국물 있는 건 빼줘" must not become a wanted 국물, even when other words send the sentence to the model.
    service, model = ParseService(), Model({"wanted": ["국물", "따뜻함"], "excluded": [], "unparsed": []})
    answer = service.parse("food", "어제 과음해서 국물 있는 건 빼줘", get_vocab(), model)
    assert answer["ai"] == "used" and answer["conditions"]["tags"] == ["따뜻함"]
    assert answer["unsupported"] == [{"kind": "trait", "text": "국물 제외"}]


def test_model_only_food_exclusions_need_a_diet_or_allergy_statement():
    everything = AiParse([], list(get_vocab().food.exclusions), [])
    # 2026-10-27 Lite: all 17 values for a hangover sentence, which would have left no candidate.
    assert merge({"tags": [], "excluded": []}, everything, "어제 과음해서 고소한 건 빼고 속 편한 걸로", "food")["excluded"] == []
    assert merge({"tags": [], "excluded": []}, AiParse([], ["매콤함"], []), "비 오는 날 국물 있는 건 빼줘", "food")["excluded"] == []
    assert merge({"tags": [], "excluded": []}, AiParse([], ["소고기", "유제품"], []), "비건이라 가볍게", "food")["excluded"] == ["소고기", "유제품"]


def test_a_fully_read_negation_does_not_call_the_model():
    model = Model({"wanted": ["국물"], "excluded": [], "unparsed": []})
    answer = ParseService().parse("food", "국물 있는 건 빼줘", get_vocab(), model)
    assert answer["ai"] == "not_needed" and model.calls == [] and answer["conditions"] == {"tags": [], "excluded": []}

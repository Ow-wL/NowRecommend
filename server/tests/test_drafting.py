import pytest

from app.drafting import read_inputs, similar_items
from app.llm.draft import DraftInput, clean_draft, response_schema
from app.models import Item
from app.vocab import get_vocab

FOOD = get_vocab().food
MUSIC = get_vocab().music


def food_answer(label="가케우동", **overrides):
    return {"input": label, "description": "따뜻한 국물에 굵은 면을 담은 한 그릇.", "tags": ["따뜻함", "국물", "일식", "없는태그"],
            "ingredients": ["밀", "생선", "파"], "priceLabel": "8,000–10,000원", "cost": 9000, "emoji": "🍜", "color": "#f0e9d6", **overrides}


def test_food_draft_keeps_input_name_and_flags_allergens_for_review():
    item, notes, error = clean_draft("food", DraftInput("가케우동"), food_answer(), FOOD)
    assert error is None and item["name"] == "가케우동" and item["subtitle"] == "8,000–10,000원"
    assert item["tags"] == ["따뜻함", "국물", "일식"]  # unknown tag dropped
    assert notes == ["AI 추정 재료 — 알레르기 재료 확인 필요 (현재 표시: 밀, 생선)"]


@pytest.mark.parametrize("change, error", [
    ({"input": "다른 메뉴"}, "입력과 맞지 않음"), ({"priceLabel": "싸요"}, "가격"), ({"cost": 50}, "가격"),
    ({"tags": ["없는태그"]}, "태그 부족"), ({"description": " "}, "태그 부족"),
])
def test_food_draft_rejects_bad_answers(change, error):
    assert error in clean_draft("food", DraftInput("가케우동"), food_answer(**change), FOOD)[2]


def test_music_draft_never_takes_title_or_artist_from_the_model():
    source = DraftInput("Spring Day", "BTS")
    answer = {"input": "Spring Day - BTS", "description": "그리움이 담긴 잔잔한 곡.", "tags": ["차분함", "보컬", "팝", "중간 에너지"],
              "emoji": "🌸", "color": "#f0dfe5", "known": False, "name": "다른 곡"}
    item, notes, error = clean_draft("music", source, answer, MUSIC)
    assert error is None and (item["name"], item["artist"], item["subtitle"]) == ("Spring Day", "BTS", "BTS")
    assert notes == ["AI가 확실히 알지 못하는 곡 — 실제 곡·아티스트·분위기 확인 필요"]
    assert clean_draft("music", DraftInput("제목만"), {**answer, "input": "제목만"}, MUSIC)[2] == "아티스트 없음"


def test_bad_colors_and_emoji_fall_back():
    item, _, _ = clean_draft("food", DraftInput("가케우동"), food_answer(color="red", emoji=""), FOOD)
    assert (item["color"], item["emoji"]) == ("#e8e4dc", "🍽️")


def test_schema_restricts_tags_to_the_vocabulary():
    schema = response_schema("food", FOOD)["properties"]["items"]["items"]["properties"]
    assert set(schema["tags"]["items"]["enum"]) == FOOD.tags and "known" not in schema
    assert "known" in response_schema("music", MUSIC)["properties"]["items"]["items"]["properties"]


def test_read_inputs_formats(tmp_path):
    names = tmp_path / "names.txt"
    names.write_text("# 점심 후보\n가케우동\n\n 가케우동 \n김치 볶음밥\n", encoding="utf-8")
    assert [i.label for i in read_inputs(names, "food")] == ["가케우동", "김치 볶음밥"]
    songs = tmp_path / "songs.txt"
    songs.write_text("Spring Day - BTS\nLove - Me - Artist\n", encoding="utf-8")
    assert [(i.name, i.artist) for i in read_inputs(songs, "music")] == [("Spring Day", "BTS"), ("Love - Me", "Artist")]
    table = tmp_path / "songs.csv"
    table.write_text("name,artist\n밤편지,아이유\n", encoding="utf-8")
    assert [(i.name, i.artist) for i in read_inputs(table, "music")] == [("밤편지", "아이유")]


def test_similar_items_by_name_and_embedding():
    draft = Item(id="f-1", category="food", name="가케 우동", artist=None, status="draft", embedding=[1.0, 0.0])
    others = [Item(id="f09", category="food", name="우동", artist=None, status="reviewed", embedding=[0.0, 1.0]),
              Item(id="f02", category="food", name="닭곰탕", artist=None, status="reviewed", embedding=[0.99, 0.141]),
              Item(id="f03", category="food", name="버섯 리조토", artist=None, status="rejected", embedding=[1.0, 0.0])]
    warnings = similar_items(draft, others, threshold=0.95)
    assert warnings[0].startswith("이름이 비슷한 항목: 우동 (f09")
    assert warnings[1].startswith("내용이 비슷한 항목: 닭곰탕 (f02") and len(warnings) == 2  # rejected items are ignored


class Overloaded(Exception):
    def __init__(self, code):
        super().__init__(f"HTTP {code}")
        self.code = code


def test_overloaded_batches_are_retried_but_spent_quota_is_not():
    from app.drafting import _request_with_retry
    from app.llm.client import CoolingDown

    class Model:
        model = "fake"

        def __init__(self, errors):
            self.errors, self.calls = list(errors), 0

        def generate_json(self, system, payload, schema):
            self.calls += 1
            if self.errors:
                raise self.errors.pop(0)
            return {"items": []}

    waits = []
    model = Model([Overloaded(503), CoolingDown("retry after 9s")])
    assert _request_with_retry(model, "food", [DraftInput("우동", None)], get_vocab().food, 2, 15, waits.append) == []
    assert model.calls == 3 and waits == [15, 15]
    quota = Model([Overloaded(429)])
    with pytest.raises(Overloaded):
        _request_with_retry(quota, "food", [DraftInput("우동", None)], get_vocab().food, 2, 15, waits.append)
    assert quota.calls == 1

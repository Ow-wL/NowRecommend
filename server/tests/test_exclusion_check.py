from app.dish_facts import name_attributes
from app.llm.free import SYSTEM, validate_free


def pick(name, detail="한식", **extra):
    return {"name": name, "detail": detail, "tasteReason": "취향에 가까워요", "contextReason": "상황에 어울려요", "confidence": "high", "tags": [], "ingredients": [], **extra}


def names(result):
    return [p.name for p in result.picks]


def check(raw, excluded, count=None, dishes=None):
    return validate_free(raw, count or len(raw), [], detail_required=False, excluded_values=excluded, dishes=dishes)


def test_a_dish_is_dropped_by_its_name_even_when_the_model_lists_no_such_ingredient():
    result = check([pick("마르게리타 피자", ingredients=["밀", "토마토"]), pick("알리오 올리오", ingredients=["밀"])], ["유제품"], 1)
    assert names(result) == ["알리오 올리오"] and result.issues["excluded_by_name"] == 1 and result.dropped_by_name == ["마르게리타 피자"]


def test_the_detail_counts_too():
    assert names(check([pick("불맛 국밥", "한식 · 얼큰한 국물"), pick("맑은 국밥", "한식 · 맑은 국물")], ["매콤함"], 1)) == ["맑은 국밥"]


def test_only_a_dish_of_exactly_that_name_borrows_the_reviewed_facts():
    reviewed = {"크림 파스타": {"유제품", "밀"}, "순두부 찌개": {"돼지고기", "콩"}}
    result = check([pick("크림 파스타x", baseDish="크림 파스타"), pick("순두부찌개")], ["돼지고기"], 1, reviewed)
    assert names(result) == ["크림 파스타x"] and result.issues["excluded_by_name"] == 1  # spacing does not make it another dish
    assert names(check([pick("알리오 올리오", baseDish="크림 파스타")], ["유제품"], 1, reviewed)) == ["알리오 올리오"]


def test_a_reviewed_trait_counts_as_well_as_an_ingredient():
    assert names(check([pick("잡채밥"), pick("곤드레밥")], ["매콤함"], 1, {"잡채밥": {"매콤함", "한식"}})) == ["곤드레밥"]


def test_nothing_is_dropped_by_name_without_an_exclusion():
    result = validate_free([pick("마르게리타 피자"), pick("칼국수")], 2, [], detail_required=False, excluded_values=None, dishes={"칼국수": {"밀"}})
    assert names(result) == ["마르게리타 피자", "칼국수"] and not result.issues


def test_songs_are_not_read_as_dishes():
    song = {"name": "치즈", "detail": "버터 크림", "tasteReason": "취향에 가까워요", "contextReason": "상황에 어울려요", "confidence": "high", "tags": []}
    assert len(validate_free([song], 1, [], excluded_values=["보컬"]).picks) == 1


def test_names_that_only_look_like_a_broken_exclusion_stay():
    assert "유제품" not in name_attributes("비건 치즈 샌드위치") and "밀" not in name_attributes("쌀국수") and "밀" in name_attributes("비건 치즈 샌드위치")


def test_the_prompt_tells_the_model_not_to_bend_the_list():
    assert "ingredients를 줄이거나 바꾸지 않는다" in SYSTEM["food"]

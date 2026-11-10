import copy

import pytest

from app.catalog import load_seed
from app.dish_facts import table_hits as lexicon_hits
from app.evaluation_ai import (answer_ai, check_songs, ingredient_shifts, item_labels, judge_run, load_ai_cases, load_run, pick_flags, regressions, render_report,
                               request_for, reviewed_dishes, run_cases, song_store, store_lookup, summarize, taste_overlap)

DATA = load_ai_cases()
SEED_IDS = {i["id"] for i in load_seed()}
BY_ID = {c["id"]: c for c in DATA["cases"]}
LEXICON = DATA["lexicon"]


class FakeModel:
    model = "fake"

    def __init__(self, answer):
        self.answer, self.payloads, self.systems = answer, [], []

    def generate_json(self, system, payload, schema):
        self.payloads.append(payload)
        self.systems.append(system)
        result = self.answer(payload) if callable(self.answer) else self.answer
        if isinstance(result, Exception):
            raise result
        return result


def food_pick(name, **extra):
    return {"name": name, "detail": "한식", "tasteReason": "취향에 가까워요", "contextReason": "상황에 어울려요", "confidence": "high", "tags": ["담백함"], "ingredients": [], "baseDish": "", "broad": False, **extra}


def song_pick(name, artist, **extra):
    return {"name": name, "detail": artist, "tasteReason": "취향에 가까워요", "contextReason": "상황에 어울려요", "confidence": "high", "tags": ["차분함"], "releaseYear": 2005, **extra}


def verdict(payload, **change):
    return {"judgments": [{"index": p["index"], "fit": 2, "breaksExclusion": False, "opposesRequest": False, "real": "yes", "yearOk": True, "note": "맞음", **change} for p in payload["picks"]]}


def record(names, judge=None, wanted=3, failures=()):
    return {"wanted": wanted, "ms": 100.0, "failures": list(failures), "issues": {}, "picks": [{"name": n, "detail": ""} for n in names], **({"judge": judge} if judge else {})}


def judged(fit=2, **change):
    return {"index": 0, "fit": fit, "breaksExclusion": False, "opposesRequest": False, "real": "yes", "yearOk": True, "note": "", **change}


def test_case_set_covers_every_kind_in_both_categories():
    assert len(BY_ID) == len(DATA["cases"]) == 48
    for category in ("food", "music"):
        kinds = {c["kind"] for c in DATA["cases"] if c["category"] == category}
        assert {"situation", "exclusion", "conflict", "taste"} <= kinds
    assert {c["kind"] for c in DATA["cases"]} == set(DATA["kinds"])


@pytest.mark.parametrize("case", DATA["cases"], ids=[c["id"] for c in DATA["cases"]])
def test_every_case_is_a_request_the_api_accepts(case):
    request = request_for(DATA, case)
    assert request.engine is None and set(request.profile.selected) <= SEED_IDS
    assert all(i.startswith(case["category"][0]) for i in request.profile.selected)
    assert set(case.get("opposite", [])) <= set(LEXICON)


def test_taste_cases_come_in_pairs_with_the_same_request_and_different_tastes():
    groups = {}
    for case in DATA["cases"]:
        if case["kind"] == "taste":
            groups.setdefault(case["pair"], []).append(case)
    assert groups and all(len(g) == 2 and g[0]["text"] == g[1]["text"] and g[0]["persona"] != g[1]["persona"] for g in groups.values())


@pytest.mark.parametrize("text,attribute", [("칼국수", "밀"), ("돈까스 정식", "돼지고기"), ("크림 파스타", "유제품"), ("클래식 버거", "유제품"), ("양갈비 구이", "양고기"), ("마라 양꼬치", "양고기"), ("참치마요 덮밥", "생선"), ("제육볶음", "매콤함"), ("막국수", "메밀"), ("들기름 막국수", "밀"), ("평양냉면", "밀"), ("순두부찌개", "콩"), ("닭곰탕", "닭고기"), ("차돌된장찌개", "소고기")])
def test_the_table_recognises_what_the_name_makes_plain(text, attribute):
    assert attribute in lexicon_hits(LEXICON, text)


@pytest.mark.parametrize("text,attribute", [("쌀국수", "밀"), ("닭곰탕", "소고기"), ("백짬뽕", "매콤함"), ("맑은 순두부찌개", "매콤함"), ("맑은순두부찌개", "매콤함"), ("양념치킨", "양고기"), ("양파 수프", "양고기"), ("양송이 리조토", "양고기"), ("간장떡볶이", "매콤함"), ("콩나물국밥", "콩"), ("유부초밥", "생선"), ("연어 스테이크", "소고기"), ("햄버거", "돼지고기")])
def test_the_table_does_not_flag_look_alike_names(text, attribute):
    assert attribute not in lexicon_hits(LEXICON, text)


def test_a_dish_breaking_an_exclusion_is_flagged_whatever_the_model_claimed():
    wheat = BY_ID["FX1"]  # 밀 제외
    assert pick_flags(DATA, wheat, {"name": "바지락 칼국수", "detail": "한식", "ingredients": []})["broken"] == ["밀"]
    assert pick_flags(DATA, wheat, {"name": "쌀국수", "detail": "베트남 · 면"})["broken"] == []
    assert pick_flags(DATA, BY_ID["MX1"], {"name": "칼국수", "detail": ""}) == {"broken": [], "opposite": []}  # the table is about food


def test_the_live_bug_of_spicy_dishes_for_a_mild_request_is_caught():
    mild = BY_ID["FC1"]
    assert mild["persona"] == "food-spicy-rated" and "담백함" in mild["conditions"]["tags"]
    assert pick_flags(DATA, mild, {"name": "제육볶음", "detail": "한식"})["opposite"] == ["매콤함"]
    assert pick_flags(DATA, mild, {"name": "닭곰탕", "detail": "한식"})["opposite"] == []


def test_answer_uses_the_production_prompt_and_checks_without_a_database():
    model = FakeModel({"picks": [food_pick("삼계탕"), food_pick("닭곰탕", ingredients=["밀"]), food_pick("곤드레밥"), food_pick("콩나물국밥")]})
    result = answer_ai(DATA, BY_ID["FX1"], model, item_labels(), reviewed_dishes())
    assert [p["name"] for p in result["picks"]] == ["삼계탕", "곤드레밥", "콩나물국밥"]  # the one listing 밀 was dropped by validate_free
    assert result["issues"]["excluded_value"] == 1 and result["failures"] == []
    payload = model.payloads[0]
    assert payload["excluded"] == ["밀"] and payload["count"] == 3 + 6 and len(payload["baseDishes"]) == 81


def test_taste_reaches_the_model_as_production_sends_it():
    model = FakeModel({"picks": [food_pick("닭곰탕"), food_pick("죽"), food_pick("두부 덮밥x")]})
    answer_ai(DATA, BY_ID["FC1"], model, item_labels(), reviewed_dishes())
    taste = model.payloads[0]["taste"]
    assert taste["liked"] == ["김치찌개", "마라탕"] and taste["likedTags"] == ["매콤함"] and "제육볶음: 먹어 보니 좋았어요" in taste["likedText"]


def test_the_request_behind_the_live_bug_is_sent_as_it_was():
    model = FakeModel({"picks": [food_pick("죽"), food_pick("미역국"), food_pick("두부조림")]})
    answer_ai(DATA, BY_ID["FC5"], model, item_labels(), reviewed_dishes())
    payload = model.payloads[0]
    assert payload["taste"]["likedTags"] == ["국물", "매콤함"] and payload["taste"]["likedText"] == ["비빔밥: 먹어 보니 좋았어요"]
    assert payload["avoid"] == ["쌀국수", "닭곰탕"] and payload["wanted"] == ["저녁", "담백함"]


def test_an_ingredient_that_disappears_only_when_excluded_is_reported():
    run = {"meta": {}, "cases": {"FS1": {**record([]), "picks": [{"name": "순두부찌개", "detail": "", "ingredients": ["돼지고기", "콩"]}]},
                                 "FX4": {**record([]), "picks": [{"name": "순두부찌개", "detail": "", "ingredients": ["콩"]}, {"name": "두부 덮밥", "detail": "", "ingredients": ["콩"]}]}}}
    shifts = ingredient_shifts(DATA, run)
    assert len(shifts) == 1 and "FX4 순두부찌개" in shifts[0] and "돼지고기" in shifts[0]
    assert "재료 목록이 요청에 따라" in render_report(DATA, {"r": run})


def test_fewer_songs_on_the_store_is_a_regression():
    song = lambda status: {"name": "곡", "detail": "가수", "store": {"status": status}}  # noqa: E731
    make = lambda *statuses: {"meta": {}, "cases": {"MS1": {**record([]), "picks": [song(s) for s in statuses]}}}  # noqa: E731
    assert any("스토어" in f for f in regressions(DATA, make("found", "missing"), make("found", "found")))
    assert regressions(DATA, make("found", "found"), make("found", "missing")) == []


def test_a_failed_or_empty_answer_is_retried_and_counted():
    calls = iter([RuntimeError("503"), {"picks": []}, {"picks": [food_pick("죽"), food_pick("덮밥"), food_pick("국밥")]}])
    model, waits = FakeModel(lambda payload: next(calls)), []
    result = answer_ai(DATA, BY_ID["FS1"], model, item_labels(), reviewed_dishes(), sleep=waits.append)
    assert result["failures"] == ["RuntimeError", "Empty"] and len(result["picks"]) == 3 and len(waits) == 2
    gone = answer_ai(DATA, BY_ID["FS1"], FakeModel(RuntimeError("down")), item_labels(), reviewed_dishes(), sleep=waits.append)
    assert gone["picks"] == [] and len(gone["failures"]) == 3


def test_a_run_saves_each_case_and_continues_where_it_stopped(tmp_path):
    path, asked = tmp_path / "r.json", []
    answer = lambda case: asked.append(case["id"]) or record(["죽"])  # noqa: E731
    run = load_run(path, {"engine": "ai"})
    assert run_cases(DATA, run, path, answer, limit=2, only="FS", log=lambda _: None) == 2
    again = load_run(path)
    assert again["meta"] == {"engine": "ai"} and set(again["cases"]) == {"FS1", "FS2"}
    run_cases(DATA, again, path, answer, limit=1, only="FS", log=lambda _: None)
    assert asked == ["FS1", "FS2", "FS3"]


def test_the_judge_sees_names_only_and_a_partial_answer_is_not_kept(tmp_path):
    path = tmp_path / "r.json"
    run = {"meta": {}, "cases": {"FX1": {**record(["칼국수", "죽"]), "picks": [{"name": "칼국수", "detail": "한식", "tags": ["담백함"], "ingredients": [], "confidence": "high", "taste_reason": "비밀"}, {"name": "죽", "detail": "", "tags": []}]}, "FS1": record(["국밥", "짬뽕"])}}
    def answer(payload):
        return {"judgments": verdict(payload)["judgments"][:1]} if payload["request"].startswith("비") else verdict(payload)
    model = FakeModel(answer)
    done, failed = judge_run(DATA, run, path, model, item_labels(), log=lambda _: None)
    assert (done, failed) == (1, 1)
    sent = model.payloads[1]
    assert sent["picks"][0] == {"index": 0, "name": "칼국수", "detail": "한식"} and sent["excluded"] == ["밀"]
    assert len(run["cases"]["FX1"]["judge"]) == 2 and "judge" not in run["cases"]["FS1"]
    model.answer = verdict
    assert judge_run(DATA, run, path, model, item_labels(), log=lambda _: None) == (1, 0)  # only what is left


def test_the_judge_stops_when_the_quota_is_gone(tmp_path):
    run = {"meta": {}, "cases": {c["id"]: record(["죽"]) for c in DATA["cases"]}}
    model = FakeModel(RuntimeError("429"))
    assert judge_run(DATA, run, tmp_path / "r.json", model, item_labels(), log=lambda _: None, give_up_after=3) == (0, 3)
    assert len(model.payloads) == 3


def test_store_lookup_finds_by_either_door_and_tells_a_failure_from_a_miss():
    hit = {"trackName": "밤편지", "artistName": "IU 아이유", "releaseDate": "2017-03-24T12:00:00Z", "wrapperType": "track"}
    us = lambda path, params: [hit] if path == "search" and params["country"] == "US" else []  # noqa: E731
    assert store_lookup("밤편지", "아이유", us) == {"status": "found", "year": 2017}
    def korea(path, params):
        if params["country"] == "US":
            return []
        return [{"artistId": 1}] if path == "search" else [hit]
    assert store_lookup("밤편지", "아이유", korea)["status"] == "found"
    assert store_lookup("없는 곡", "아무개", lambda path, params: [])["status"] == "missing"
    assert store_lookup("밤편지", "다른 사람", us)["status"] == "missing"  # the title alone is not the song
    def broken(path, params):
        raise OSError("down")
    assert store_lookup("밤편지", "아이유", broken)["status"] == "failed"


def test_songs_are_asked_once_and_failures_are_asked_again(tmp_path):
    song = {"name": "밤편지", "detail": "아이유"}
    run = {"meta": {}, "cases": {"MS1": {**record([]), "picks": [dict(song), {"name": "X", "detail": "Y"}]}, "MS3": {**record([]), "picks": [dict(song)]}}}
    answers, asked = {"밤편지": {"status": "found", "year": 2017}, "X": {"status": "failed"}}, []
    def lookup(title, artist):
        asked.append(title)
        return answers[title]
    assert check_songs(DATA, run, tmp_path / "r.json", pace=0, lookup=lookup, log=lambda _: None) == 2
    assert asked == ["밤편지", "X"] and run["cases"]["MS3"]["picks"][0]["store"]["year"] == 2017
    answers["X"] = {"status": "missing"}
    check_songs(DATA, run, tmp_path / "r.json", pace=0, lookup=lookup, log=lambda _: None)
    assert asked == ["밤편지", "X", "X"]
    assert song_store(DATA, run)["found"] == pytest.approx(2 / 3)


def test_summary_separates_what_was_not_measured_from_zero():
    run = {"meta": {}, "cases": {"FS1": record(["국밥", "짬뽕"])}}
    m = summarize(DATA, run, [BY_ID["FS1"]])
    assert m["good"] is None and m["judge_broken"] is None and m["table_broken"] == 0
    run["cases"]["FS1"]["judge"] = [judged(2), judged(0, opposesRequest=True)]
    m = summarize(DATA, run, [BY_ID["FS1"]])
    assert (m["good"], m["acceptable"], m["hit"], m["opposes"]) == (0.5, 0.5, 1.0, 0.5)
    assert m["judge_broken"] is None  # no exclusion was asked for in this case


def test_taste_overlap_compares_the_two_sides_of_a_pair():
    run = {"meta": {}, "cases": {"FT1a": record(["a", "b", "c"]), "FT1b": record(["a", "d", "e"])}}
    assert taste_overlap(DATA, run, "food") == pytest.approx(1 / 5)
    assert taste_overlap(DATA, run, "music") is None


def baseline_run():
    cases = {c["id"]: record(["국밥"] if c["category"] == "food" else [], [judged(2)] if c["category"] == "food" else None) for c in DATA["cases"]}
    return {"meta": {}, "cases": cases}


def test_the_check_ignores_noise_and_names_real_regressions():
    base = baseline_run()
    assert regressions(DATA, copy.deepcopy(base), base) == []
    worse = copy.deepcopy(base)
    for case_id in ("FX1", "FX3"):
        worse["cases"][case_id] = record(["칼국수", "연어 초밥"], [judged(2), judged(2)])
    found = regressions(DATA, worse, base)
    assert any("필수 제외" in f for f in found) and len(found) == 1
    assert regressions(DATA, base, worse) == []  # better is not a regression
    spicy = copy.deepcopy(base)
    spicy["cases"]["FC1"] = record(["제육볶음"], [judged(2)])
    assert regressions(DATA, spicy, base) == []  # one case is what two runs of the same code differ by
    spicy["cases"]["FC2"] = record(["불닭볶음면"], [judged(2)])
    assert any("반대" in f for f in regressions(DATA, spicy, base))
    tired = copy.deepcopy(base)
    for case_id, entry in tired["cases"].items():
        if case_id.startswith("F"):
            entry["judge"] = [judged(1)]
    assert any("good" in f for f in regressions(DATA, tired, base))


def test_report_puts_runs_side_by_side_and_lists_what_to_look_at():
    run = {"meta": {}, "cases": {"FX1": record(["칼국수"], [judged(0, breaksExclusion=True, note="밀 면")]), "MS1": {**record([]), "wanted": 5, "picks": [{"name": "밤편지", "detail": "아이유", "store": {"status": "found", "year": 2017}}]}}}
    report = render_report(DATA, {"AI 1회차": run, "빈 실행": {"meta": {}, "cases": {}}}, "메모")
    assert "| AI 1회차 | 1 |" in report and "| 빈 실행 | 0 |" in report and "메모" in report
    assert "칼국수" in report and "판별표: 밀 제외 위반" in report and "심사: 제외 위반" in report and "밀 면" in report
    assert "| AI 1회차 | 1 | 0 | 0 |" in report

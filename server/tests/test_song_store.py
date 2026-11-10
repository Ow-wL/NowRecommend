import urllib.error

from app.llm.free import validate_free
from app.song_store import FOUND, MISSING, UNKNOWN, SongStore


class FakeStore:
    """US search hits by term, Korean names by track id; records every request."""

    def __init__(self, us: dict[str, list[dict]], kr: dict[int, dict] | None = None, fail: set[str] = frozenset()):
        self.us, self.kr, self.fail, self.calls = us, kr or {}, fail, []

    def __call__(self, path: str, params: dict, timeout: float) -> list[dict]:
        self.calls.append((path, params))
        if path == "search":
            if params["term"] in self.fail:
                raise OSError("down")
            return self.us.get(params["term"], [])
        return [self.kr[int(i)] for i in str(params["id"]).split(",") if int(i) in self.kr]


def hit(track_id: int, title: str, artist: str) -> dict:
    return {"trackId": track_id, "trackName": title, "artistName": artist}


def test_us_names_settle_a_song_in_one_request():
    fake = FakeStore({"BTS Dynamite": [hit(1, "Dynamite", "BTS")]})
    assert SongStore(fake).check([("Dynamite", "BTS")]) == [FOUND]
    assert [c[0] for c in fake.calls] == ["search"]


def test_korean_titles_are_read_back_from_the_korean_store():
    # The US store answers "너의 의미" with its English name; one lookup by id gives the Korean one (2026-11-10).
    fake = FakeStore({"산울림 너의 의미": [hit(7, "Meaning of You", "Sanullim")],
                      "10CM 사랑은 은하수 카페에서": [hit(8, "Love in the Milky Way Cafe", "10CM")]},
                     {7: hit(7, "너의 의미", "산울림"), 8: hit(8, "사랑은 은하수 다방에서", "10CM")})
    assert SongStore(fake).check([("너의 의미", "산울림"), ("사랑은 은하수 카페에서", "10CM")]) == [FOUND, MISSING]
    assert [c[0] for c in fake.calls].count("lookup") == 1  # one lookup for the whole answer


def test_no_hits_is_missing_and_a_failed_request_is_unknown():
    fake = FakeStore({}, fail={"QWER 첫 만남은 계획대로 되지 않아"})
    assert SongStore(fake).check([("꽃길만 레이디", "적재"), ("첫 만남은 계획대로 되지 않아", "QWER")]) == [MISSING, UNKNOWN]


def test_answers_are_kept_and_the_budget_is_never_exceeded():
    now = [0.0]
    fake = FakeStore({"A a": [hit(1, "a", "A")]})
    store = SongStore(fake, per_minute=2, clock=lambda: now[0])
    assert store.check([("a", "A"), ("b", "B"), ("c", "C")]) == [FOUND, MISSING, UNKNOWN]  # the third did not fit in the minute
    assert store.check([("a", "A"), ("b", "B")]) == [FOUND, MISSING]  # from memory
    assert len(fake.calls) == 2
    now[0] = 61
    assert store.check([("c", "C")]) == [MISSING]


def test_a_refusal_pauses_the_checks():
    now = [0.0]

    def refuse(path, params, timeout):
        raise urllib.error.HTTPError("u", 429, "slow down", {}, None)

    store = SongStore(refuse, clock=lambda: now[0], pause_s=120)
    assert store.check([("a", "A")]) == [UNKNOWN]
    store.get = FakeStore({"A b": [hit(1, "b", "A")]})
    now[0] = 60
    assert store.check([("b", "A")]) == [UNKNOWN]  # still paused
    now[0] = 130
    assert store.check([("b", "A")]) == [FOUND]


def song(name: str, artist: str) -> dict:
    return {"name": name, "detail": artist, "tasteReason": "취향", "contextReason": "상황", "confidence": "high", "releaseYear": 2020}


def test_listed_songs_go_first_and_spares_replace_unlisted_ones():
    fake = FakeStore({"QWER 첫 만남은 계획대로 되지 않아": [hit(1, "Fake Song", "QWER")], "TWS 첫 만남은 계획대로 되지 않아": [hit(2, "plot twist", "TWS")],
                      "BTS Dynamite": [hit(3, "Dynamite", "BTS")], "IU 밤편지": [hit(4, "Through the Night", "IU")]},
                     {1: hit(1, "다른 곡", "QWER"), 2: hit(2, "첫 만남은 계획대로 되지 않아", "TWS"), 4: hit(4, "밤편지", "아이유")})
    raw = [song("첫 만남은 계획대로 되지 않아", "QWER"), song("Dynamite", "BTS"), song("밤편지", "IU"), song("첫 만남은 계획대로 되지 않아", "TWS")]
    result = validate_free(raw, 3, [], rank=SongStore(fake).rank)
    assert [(p.detail, p.listed) for p in result.picks] == [("BTS", FOUND), ("IU", FOUND), ("TWS", FOUND)]
    assert result.issues == {"extra": 1}


def test_an_unlisted_song_still_fills_a_short_answer():
    result = validate_free([song("꽃길만 레이디", "적재"), song("Dynamite", "BTS")], 2, [], rank=SongStore(FakeStore({"BTS Dynamite": [hit(3, "Dynamite", "BTS")]})).rank)
    assert [(p.name, p.listed) for p in result.picks] == [("Dynamite", FOUND), ("꽃길만 레이디", MISSING)]

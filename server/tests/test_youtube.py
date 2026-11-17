"""A song's YouTube video for the player in its details (app/youtube.py, routes/youtube.py, 2026-11-18). The API is stood in
for; the route runs on SQLite with the daily counters only."""
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings, get_settings
from app.db import get_session
from app.main import create_app
from app.models import Feedback, UsageDaily, User
from app.routes.youtube import find_song
from app.youtube import FOUND_TTL, MISSING_TTL, YouTubeFinder, YouTubeUnavailable, candidates, playable, youtube_finder


def hit(video_id: str, title: str, channel: str, live: str = "none") -> dict:
    return {"id": {"kind": "youtube#video", "videoId": video_id}, "snippet": {"title": title, "channelTitle": channel, "liveBroadcastContent": live}}


def status(video_id: str, embeddable=True, age=False, blocked=(), allowed=None, privacy="public", kids=False) -> dict:
    details = {**({"contentRating": {"ytRating": "ytAgeRestricted"}} if age else {}),
               **({"regionRestriction": {**({"blocked": list(blocked)} if blocked else {}), **({"allowed": allowed} if allowed is not None else {})}} if blocked or allowed is not None else {})}
    return {"id": video_id, "status": {"embeddable": embeddable, "privacyStatus": privacy, **({} if kids is None else {"madeForKids": kids})}, "contentDetails": details}


NIGHT = [
    hit("cover000001", "밤편지 (Through the Night) - 아이유 COVER by 누군가", "누군가 노래"),
    hit("someone0001", "밤편지 - 다른가수", "다른가수 Official"),
    hit("mvofficial1", "[MV] IU(아이유) _ Through the Night(밤편지)", "1theK (원더케이)"),
    hit("topicchan01", "밤편지", "IU - Topic"),
    hit("ownchannel1", "IU 'Through the Night' Live Clip", "이지금 [IU Official]"),
    hit("liveliveliv", "아이유 밤편지 라이브", "IU - Topic", live="live"),
    hit("loophour001", "아이유 밤편지 1시간 반복", "IU - Topic"),
    hit("bad id", "밤편지", "IU - Topic"),
]


def test_the_song_as_released_comes_first_and_what_is_not_it_is_left_out():
    # The artist's "- Topic" channel, then a video whose title names the artist. Not: a cover, the same title by someone
    # else, a live broadcast, an hour-long loop, a malformed id, a video that does not carry the title.
    assert candidates("밤편지", "아이유", NIGHT) == ["topicchan01", "mvofficial1"]  # the live clip names only "Through the Night"
    # A title known under its English name on most uploads ("에잇" is "eight").
    assert candidates("에잇", "아이유", [hit("eightmv0001", "[MV] IU(아이유) _ eight(Prod.&Feat. SUGA of BTS)", "1theK (원더케이)")]) == ["eightmv0001"]
    assert candidates("밤편지", "아이유", []) == []


def test_real_search_results_of_2026_11_18_are_ranked_as_a_listener_would():
    """Titles as the API sent them for "아이유 밤편지" and "방탄소년단 Dynamite" (entities and all)."""
    night = [hit("EjMTw4xLcBI", "아이유(IU) - 밤편지 [가사/Lyrics]", "누군가"), hit("BzYnNdJhZQw", "[MV] IU(아이유) _ Through the Night(밤편지)", "1theK (원더케이)"),
             hit("2ltiSmgb-Sc", "아이유 - 밤편지 [유희열의 스케치북/You Heeyeol&#39;s Sketchbook] | KBS 200918 방송", "KBS Kpop"),
             hit("6744glqD6lk", "Through the Night (밤편지)", "IU - Topic"), hit("D67jNiKLWC8", "[TJ노래방] 밤편지 - IU / TJ Karaoke", "TJ노래방 공식 유튜브채널"),
             hit("DFzPmaNb7fk", "[IU] Through the Night(밤편지) Concert Live Clip (@ 2017 Tour 팔레트)", "이지금 [IU Official]")]
    picked = candidates("밤편지", "아이유", night)
    assert picked[:2] == ["6744glqD6lk", "BzYnNdJhZQw"] and "D67jNiKLWC8" not in picked and picked.index("DFzPmaNb7fk") < picked.index("EjMTw4xLcBI")
    dynamite = [hit("gdZLi9oWNZg", "BTS (방탄소년단) &#39;Dynamite&#39; Official MV", "HYBE LABELS"),
                hit("e81ad5MpfQ0", "BTS (방탄소년단) &#39;Dynamite&#39; @ America&#39;s Got Talent 2020", "BANGTANTV"),
                hit("CN4fffh7gmk", "[CHOREOGRAPHY] BTS (방탄소년단) &#39;Dynamite&#39; Dance Practice", "BANGTANTV"),
                hit("KhZ5DCd7m6s", "BTS Dynamite Lyrics (Color Coded Lyrics)", "Jaeguchi")]
    assert candidates("Dynamite", "방탄소년단", dynamite)[0] == "gdZLi9oWNZg" and "CN4fffh7gmk" not in candidates("Dynamite", "방탄소년단", dynamite)


def test_a_fan_channel_is_not_taken_for_the_artist_and_tricks_around_the_word_list_do_not_pass():
    ranked = candidates("밤편지", "아이유", [hit("fanaudio001", "아이유 밤편지 Official Audio", "아이유 팬 채널"),
                                            hit("1themv00001", "[MV] IU(아이유) _ Through the Night(밤편지)", "1theK (원더케이)"),
                                            hit("ownchanne01", "[IU] 밤편지 MV", "이지금 [IU Official]")])
    assert ranked[0] == "ownchanne01"  # the artist's own channel; a fan channel saying "Official" gains no more than the label's MV
    for trick in ["아이유 밤편지 1시간반복", "아이유 밤편지 커버곡", "아이유 밤편지 교차 편집", "IU 밤편지 fan cam"]:
        assert candidates("밤편지", "아이유", [hit("trickvideo1", trick, "누군가")]) == [], trick
    assert candidates("눈의 꽃", "박효신", [hit("snowflower1", "박효신 - 눈의꽃 MV", "박효신")]) == ["snowflower1"]  # the same words, spaced otherwise
    # Names that only look like the artist's channel gain nothing; words that only contain a left-out word stay in.
    for fan in ["아이유 팬 Official", "아이유 팬 - Topic"]:
        assert candidates("밤편지", "아이유", [hit("fanchannel1", "아이유 밤편지", fan), hit("1themv00002", "[MV] IU(아이유) _ Through the Night(밤편지)", "1theK (원더케이)")])[0] == "1themv00002", fan
    assert candidates("디스커버리", "누군가", [hit("discovery01", "누군가 - 디스커버리", "누군가")]) == ["discovery01"]
    assert candidates("밤편지", "아이유", [hit("womancover1", "아이유 밤편지 (여자커버)", "누군가")]) == []
    assert candidates("밤편지", "아이유", [hit("anmu0000001", "아이유 밤편지 - 그동안 무엇을 했나", "IU - Topic")]) == ["anmu0000001"]  # not "안무"
    assert candidates("디스커버리", "누군가", [hit("discovery02", "누군가 - 디스 커버리", "누군가")]) == ["discovery02"]
    assert candidates("밤편지", "아이유", [hit("ourcover001", "아이유 밤편지 우리 커버", "누군가")]) == []
    assert candidates("Meet Me in St. Louis", "누군가", [hit("stlouis0001", "누군가 - Meet Me in St. Louis", "누군가")]) == ["stlouis0001"]


def test_short_names_and_titles_count_only_as_words_of_their_own():
    assert candidates("밤편지", "아이유", [hit("premium0001", "Premium 밤편지 모음", "Premium Music")]) == []  # "IU" is not in "Premium"
    assert candidates("봄날", "방탄소년단", [hit("springday01", "봄날의 기억 - BTS", "누군가")]) == []  # not "봄날"
    assert candidates("봄날", "방탄소년단", [hit("springday02", "BTS (방탄소년단) '봄날 (Spring Day)' Official MV", "HYBE LABELS")]) == ["springday02"]
    # A word of the song's own title does not count against it.
    assert candidates("Butter (Remix)", "방탄소년단", [hit("butterremix", "BTS 'Butter (Hotter Remix)' Official Audio", "BTS - Topic")]) == ["butterremix"]
    assert candidates("Butter", "방탄소년단", [hit("butterremi2", "BTS 'Butter (Hotter Remix)' Official Audio", "BTS - Topic")]) == []
    assert candidates("Butter", "방탄소년단", [hit("butterofmv1", "BTS (방탄소년단) 'Butter' Official MV", "HYBE LABELS")]) == ["butterofmv1"]  # by "BTS" too
    assert candidates("Discover", "누군가", [hit("discover001", "누군가 - Discover", "누군가 - Topic")]) == ["discover001"]  # "cover" inside a word


def test_a_video_is_offered_only_where_it_can_be_played():
    assert playable(status("a" * 11))
    assert not playable(status("a" * 11, embeddable=False))
    assert not playable(status("a" * 11, age=True))
    assert not playable(status("a" * 11, blocked=["KR"]))
    assert not playable(status("a" * 11, allowed=["US", "JP"]))
    assert playable(status("a" * 11, allowed=["KR", "US"]))
    assert not playable(status("a" * 11, privacy="private"))
    assert not playable(status("a" * 11, kids=True))
    assert not playable(status("a" * 11, kids=None))  # not said: not offered


class FakeApi:
    def __init__(self, items=NIGHT, statuses=None, fail=None):
        self.items, self.statuses, self.fail, self.calls = items, statuses, fail, []

    def __call__(self, path, params, timeout):
        self.calls.append((path, dict(params)))
        if self.fail:
            raise self.fail
        if path == "search":
            return {"items": self.items}
        ids = params["id"].split(",")
        return {"items": [s for s in (self.statuses or [status(i) for i in ids]) if s["id"] in ids]}


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_the_finder_searches_once_checks_the_candidates_and_remembers_the_answer_for_a_while():
    api, clock = FakeApi(statuses=[status("topicchan01", embeddable=False), status("mvofficial1")]), Clock()
    finder = YouTubeFinder("the-key", get=api, now=clock)
    assert finder.known("밤편지", "아이유") == (False, None)
    assert finder.find("밤편지", "아이유") == "mvofficial1"  # the Topic video may not be embedded: the next one
    search, check = api.calls
    assert search[0] == "search" and search[1]["q"] == "아이유 밤편지" and search[1]["videoEmbeddable"] == "true" and search[1]["regionCode"] == "KR"
    assert search[1]["videoSyndicated"] == "true"
    assert check == ("videos", {"part": "status,contentDetails", "id": "topicchan01,mvofficial1", "key": "the-key"})
    assert finder.known("밤편지", "아이유") == (True, "mvofficial1")
    clock.t += FOUND_TTL + 1
    assert finder.known("밤편지", "아이유") == (False, None)  # due again

    # Nothing to offer is remembered too, for a day, and costs no second call when no video carried the title.
    api = FakeApi(items=[hit("someone0001", "다른 노래", "누군가")])
    finder = YouTubeFinder("the-key", get=api, now=clock)
    assert finder.find("밤편지", "아이유") is None and [c[0] for c in api.calls] == ["search"]
    assert finder.known("밤편지", "아이유") == (True, None)
    clock.t += MISSING_TTL + 1
    assert finder.known("밤편지", "아이유") == (False, None)


def test_an_answer_past_its_time_is_dropped_not_only_ignored():
    api, clock = FakeApi(), Clock()
    finder = YouTubeFinder("the-key", get=api, now=clock)
    finder.find("밤편지", "아이유")
    clock.t += FOUND_TTL + 1
    finder.known("다른 곡", "누군가")  # any later look at the memory
    assert ("밤편지", "아이유") not in finder.kept


def test_the_memory_is_swept_on_a_clock_even_when_nobody_asks():
    import time as clock_time

    clock = Clock()
    finder = YouTubeFinder("the-key", get=FakeApi(), now=clock, sweep_every_s=0.05)
    finder.find("밤편지", "아이유")
    clock.t += FOUND_TTL + 1
    deadline = clock_time.monotonic() + 2
    while finder.kept and clock_time.monotonic() < deadline:
        clock_time.sleep(0.02)
    assert not finder.kept


def test_two_requests_for_one_song_at_once_make_one_search():
    import threading

    gate = threading.Event()

    class SlowApi(FakeApi):
        def __call__(self, path, params, timeout):
            if path == "search":
                gate.wait(2)
            return super().__call__(path, params, timeout)

    api, charged, answers = SlowApi(), [], []
    finder = YouTubeFinder("the-key", get=api)
    ask = lambda: answers.append(finder.lookup("밤편지", "아이유", lambda: charged.append(1)))  # noqa: E731
    first, second = threading.Thread(target=ask), threading.Thread(target=ask)
    first.start()
    while not finder.asking:
        pass
    second.start()
    gate.set()
    first.join(3); second.join(3)
    assert answers == ["topicchan01", "topicchan01"] and charged == [1] and [c[0] for c in api.calls] == ["search", "videos"]


def test_a_refused_charge_searches_nothing_and_lets_the_next_request_ask():
    api = FakeApi()
    finder = YouTubeFinder("the-key", get=api)

    def refuse():
        raise RuntimeError("over the limit")

    with pytest.raises(RuntimeError):
        finder.lookup("밤편지", "아이유", refuse)
    assert api.calls == [] and finder.asking == {}
    assert finder.lookup("밤편지", "아이유", lambda: None) == "topicchan01"


def test_a_failed_search_is_not_remembered_and_never_shows_the_key():
    request = httpx.Request("GET", "https://www.googleapis.com/youtube/v3/search?key=the-key")
    api = FakeApi(fail=httpx.HTTPStatusError("quota", request=request, response=httpx.Response(403, request=request)))
    finder = YouTubeFinder("the-key", get=api)
    with pytest.raises(YouTubeUnavailable) as raised:
        finder.find("밤편지", "아이유")
    assert str(raised.value) == "HTTPStatusError 403" and "the-key" not in str(raised.value)
    assert finder.known("밤편지", "아이유") == (False, None)


# ---- the route ----

@pytest.fixture
def world():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    UsageDaily.__table__.create(engine)
    User.__table__.create(engine)  # the daily removal (retention.py) runs with the first count of a day
    Feedback.__table__.create(engine)
    make = sessionmaker(engine, expire_on_commit=False)

    def session():
        with make() as s:
            yield s

    app = create_app()
    api = FakeApi()
    finder = YouTubeFinder("the-key", get=api)
    songs = {"m01": ("밤편지", "아이유")}
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[find_song] = lambda item_id: songs.get(item_id)
    app.dependency_overrides[youtube_finder] = lambda: finder
    app.dependency_overrides[get_settings] = lambda: Settings(auth_secret="test-secret", trust_proxy=True, youtube_api_key="the-key", youtube_daily_limit=3,
                                                              youtube_daily_per_address=2, rate_limit_per_minute=0)
    return TestClient(app), app, api


def at(address: str) -> dict:
    return {"X-Forwarded-For": address}


def test_a_known_song_gets_its_video_and_asking_again_costs_nothing(world):
    client, _, api = world
    first = client.get("/api/youtube/m01", headers=at("203.0.113.1"))
    assert first.status_code == 200 and first.json() == {"videoId": "topicchan01"}
    for _ in range(5):  # from memory: past the address's limit of 2 and with no new calls
        assert client.get("/api/youtube/m01", headers=at("203.0.113.1")).json() == {"videoId": "topicchan01"}
    assert [c[0] for c in api.calls] == ["search", "videos"]


def test_only_songs_the_service_knows_are_looked_for(world):
    client, _, api = world
    assert client.get("/api/youtube/f01").status_code == 404
    assert client.get("/api/youtube/" + "m" * 81).status_code == 404
    assert api.calls == []


def test_new_searches_count_against_the_caller_and_the_service(world):
    client, app, _ = world
    songs = {f"m{n:02}": (f"노래{n}", "가수") for n in range(1, 10)}
    app.dependency_overrides[find_song] = lambda item_id: songs.get(item_id)
    assert [client.get(f"/api/youtube/m0{n}", headers=at("203.0.113.1")).status_code for n in (1, 2, 3)] == [200, 200, 429]  # 2 per address
    assert client.get("/api/youtube/m04", headers=at("203.0.113.2")).status_code == 200  # the service's third
    refused = client.get("/api/youtube/m05", headers=at("203.0.113.3"))
    assert refused.status_code == 429 and "YouTube에서 찾기" in refused.json()["detail"]  # the service's day is spent
    assert client.get("/api/youtube/m06", headers=at("203.0.113.3")).status_code == 429  # and the refusal took nothing of this address


def test_without_the_key_or_when_the_api_fails_the_player_says_so(world):
    client, app, api = world
    api.fail = httpx.ConnectError("down")
    failed = client.get("/api/youtube/m01")
    assert failed.status_code == 503 and "YouTube에서 찾기" in failed.json()["detail"]
    app.dependency_overrides[youtube_finder] = lambda: None
    assert client.get("/api/youtube/m01").status_code == 503
    # YOUTUBE_DAILY_LIMIT=0 turns the player off rather than lifting the limit.
    app.dependency_overrides[youtube_finder] = lambda: YouTubeFinder("the-key", get=FakeApi())
    app.dependency_overrides[get_settings] = lambda: Settings(auth_secret="test-secret", youtube_api_key="the-key", youtube_daily_limit=0, rate_limit_per_minute=0)
    assert client.get("/api/youtube/m01").status_code == 503

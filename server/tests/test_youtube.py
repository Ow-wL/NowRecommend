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
from app.models import UsageDaily
from app.routes.youtube import find_song
from app.youtube import FOUND_TTL, MISSING_TTL, YouTubeFinder, YouTubeUnavailable, candidates, playable, youtube_finder


def hit(video_id: str, title: str, channel: str, live: str = "none") -> dict:
    return {"id": {"kind": "youtube#video", "videoId": video_id}, "snippet": {"title": title, "channelTitle": channel, "liveBroadcastContent": live}}


def status(video_id: str, embeddable=True, age=False, blocked=(), allowed=None, privacy="public") -> dict:
    details = {**({"contentRating": {"ytRating": "ytAgeRestricted"}} if age else {}),
               **({"regionRestriction": {**({"blocked": list(blocked)} if blocked else {}), **({"allowed": allowed} if allowed is not None else {})}} if blocked or allowed is not None else {})}
    return {"id": video_id, "status": {"embeddable": embeddable, "privacyStatus": privacy}, "contentDetails": details}


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
    assert candidates("밤편지", "아이유", NIGHT) == ["topicchan01", "mvofficial1"]
    # A title known under its English name on most uploads ("에잇" is "eight").
    assert candidates("에잇", "아이유", [hit("eightmv0001", "[MV] IU(아이유) _ eight(Prod.&Feat. SUGA of BTS)", "1theK (원더케이)")]) == ["eightmv0001"]
    assert candidates("밤편지", "아이유", []) == []
    assert candidates("Dynamite", "방탄소년단", [hit("dynamitemv1", "BTS (방탄소년단) 'Dynamite' Official MV", "HYBE LABELS")]) == ["dynamitemv1"]


def test_a_video_is_offered_only_where_it_can_be_played():
    assert playable(status("a" * 11))
    assert not playable(status("a" * 11, embeddable=False))
    assert not playable(status("a" * 11, age=True))
    assert not playable(status("a" * 11, blocked=["KR"]))
    assert not playable(status("a" * 11, allowed=["US", "JP"]))
    assert playable(status("a" * 11, allowed=["KR", "US"]))
    assert not playable(status("a" * 11, privacy="private"))
    assert not playable({**status("a" * 11), "status": {"embeddable": True, "madeForKids": True}})


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

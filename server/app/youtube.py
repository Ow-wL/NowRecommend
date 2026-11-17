"""A song's video on YouTube, to play in the song's details (2026-11-18).

YouTube's player plays the whole song to anyone, signed in or not, which none of the other ways to listen in the page do.
It needs the video's id, and the only sanctioned way to get one is the YouTube Data API's search: 100 searches a day per
project since 2026-06-01, a bucket of their own, reset at midnight Pacific time (the API's quota pages, read 2026-11-18).
So a video is looked for only when someone opens the player for a song, and once found it is kept for a while
(`FOUND_TTL`) in this process. The API's policies allow keeping its data for at most 30 days (Developer Policies III.E.4).

The choice is plain code, never the model (the API's results are not given to it): of the search's videos, those whose
title has the song's title in it and whose channel or title names the artist; the artist's "- Topic" channel (YouTube's
own channel of a release) first, then the artist's own channel. Covers, karaoke, reactions and hour-long loops are left
out. A second, cheap call (1 unit) reads each candidate's status: one that cannot be embedded, is age-restricted, is made
for kids (whose viewers may not be tracked, III.E.4.j), or is not shown in Korea is not offered. Which channel is "the
artist's" is a guess from its name, used only to choose; the page never calls a video official. Finding nothing is an answer too: the details then keep the search link.
"""
import logging
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from .cli.media import TITLE_ALIASES, artist_matches, norm

log = logging.getLogger(__name__)

API = "https://www.googleapis.com/youtube/v3"
FOUND_TTL = 7 * 24 * 3600  # a found video is checked again after a week (it may be taken down or blocked)
MISSING_TTL = 24 * 3600    # nothing found: asked again the next day
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
# What a video title says when it is not the song as released.
NOT_THE_SONG = re.compile(r"cover|커버|karaoke|노래방|reaction|리액션|instrumental|\binst\b|\bmr\b|1\s*시간|1\s*hour|\bloop\b|반복|교차\s*편집|"
                          r"직캠|fancam|fan\s*cam|tutorial|강좌|악보|sheet\s*music|remix|리믹스|sped\s*up|slowed|8d\b|teaser|티저|preview|미리\s*듣기",
                          re.IGNORECASE)

Getter = Callable[[str, dict, float], dict]


class YouTubeUnavailable(RuntimeError):
    """The API could not be asked (no answer in time, refused, out of quota). Not the same as "no video for this song"."""


def _get(path: str, params: dict, timeout: float) -> dict:
    key = params.pop("key", None)  # in a header, not in the address: addresses end up in logs
    response = _client.get(f"{API}/{path}", params=params, headers={"x-goog-api-key": key} if key else {}, timeout=timeout)
    response.raise_for_status()
    return response.json()


_client = httpx.Client(headers={"User-Agent": "nowrecommend-api/0.1"})


def _core(title: str) -> str:
    """The title without what stands in brackets ("Dynamite (Day Ver.)" → "Dynamite")."""
    return norm(re.sub(r"\s*[\(\[].*?[\)\]]", "", title)) or norm(title)


def candidates(title: str, artist: str, items: list[dict]) -> list[str]:
    """The search results that are this song, best first, by id. Pure: the search's `items` in, ids out."""
    want, also = _core(title), norm(TITLE_ALIASES.get(title, ""))  # "에잇" is "eight" on most uploads
    scored: list[tuple[int, int, str]] = []
    for order, item in enumerate(items):
        video_id = (item.get("id") or {}).get("videoId", "")
        snippet = item.get("snippet") or {}
        name, channel = snippet.get("title", ""), snippet.get("channelTitle", "")
        if not VIDEO_ID.match(video_id) or snippet.get("liveBroadcastContent", "none") != "none":
            continue
        if not want or not (want in norm(name) or (also and also in norm(name))) or NOT_THE_SONG.search(name):
            continue
        by_channel, by_title = artist_matches(artist, channel), artist_matches(artist, name)
        if not (by_channel or by_title):
            continue  # a song of the same name by someone else
        score = (4 if by_channel and channel.endswith(" - Topic") else 3 if by_channel else 0) + (1 if by_title else 0)
        scored.append((-score, order, video_id))
    return [video_id for _, _, video_id in sorted(scored)]


def playable(video: dict, region: str = "KR") -> bool:
    """A video the player may show here: embeddable, not age-restricted, not blocked in the region."""
    status, details = video.get("status") or {}, video.get("contentDetails") or {}
    if status.get("embeddable") is not True or status.get("privacyStatus") not in (None, "public", "unlisted") or status.get("madeForKids") is True:
        return False
    if (details.get("contentRating") or {}).get("ytRating") == "ytAgeRestricted":
        return False
    limits = details.get("regionRestriction") or {}
    return region not in limits.get("blocked", []) and ("allowed" not in limits or region in limits["allowed"])


@dataclass
class _Kept:
    video_id: str | None
    until: float


class YouTubeFinder:
    """One per process: the key, and the answers it already gave (found and not found) until they are due again."""

    def __init__(self, key: str, get: Getter = _get, timeout_s: float = 4.0, cache_size: int = 2000, now: Callable[[], float] = time.monotonic):
        self.key, self.get, self.timeout_s, self.cache_size, self.now = key, get, timeout_s, cache_size, now
        self.kept: OrderedDict[tuple[str, str], _Kept] = OrderedDict()
        self.lock = threading.Lock()

    def known(self, title: str, artist: str) -> tuple[bool, str | None]:
        """(True, answer) when this song was asked about recently; the answer may be None (no video)."""
        with self.lock:
            kept = self.kept.get((title, artist))
            if kept is None or kept.until <= self.now():
                return False, None
            self.kept.move_to_end((title, artist))
            return True, kept.video_id

    def find(self, title: str, artist: str) -> str | None:
        """The id of a video of this song that can be played here, or None. Raises YouTubeUnavailable when the API cannot
        be asked; that is not remembered."""
        try:
            found = self.get("search", {"part": "snippet", "type": "video", "videoEmbeddable": "true", "videoSyndicated": "true", "regionCode": "KR",
                                        "relevanceLanguage": "ko", "maxResults": 10, "q": f"{artist} {title}".strip(), "key": self.key}, self.timeout_s)
            ids = candidates(title, artist, found.get("items") or [])
            video_id = None
            if ids:
                details = self.get("videos", {"part": "status,contentDetails", "id": ",".join(ids), "key": self.key}, self.timeout_s)
                usable = {v.get("id") for v in details.get("items") or [] if playable(v)}
                video_id = next((i for i in ids if i in usable), None)
        except (httpx.HTTPError, ValueError) as error:
            # The key never goes to the log: httpx names the address it asked, and the address carries the key.
            raise YouTubeUnavailable(type(error).__name__ + (f" {error.response.status_code}" if isinstance(error, httpx.HTTPStatusError) else "")) from None
        with self.lock:
            self.kept[(title, artist)] = _Kept(video_id, self.now() + (FOUND_TTL if video_id else MISSING_TTL))
            self.kept.move_to_end((title, artist))
            while len(self.kept) > self.cache_size:
                self.kept.popitem(last=False)
        return video_id


_finder: YouTubeFinder | None = None
_finder_lock = threading.Lock()


def youtube_finder() -> YouTubeFinder | None:
    """The process's finder, or None without YOUTUBE_API_KEY (the player is then not offered)."""
    from .config import get_settings

    key = get_settings().youtube_api_key
    if not key:
        return None
    global _finder
    with _finder_lock:
        if _finder is None or _finder.key != key:
            _finder = YouTubeFinder(key)
        return _finder

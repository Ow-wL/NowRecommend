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
import html
import logging
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from .cli.media import ALIASES, TITLE_ALIASES, norm

log = logging.getLogger(__name__)

API = "https://www.googleapis.com/youtube/v3"
# The policy (src/legal.ts) promises at most 7 days, and YouTube allows 30. An answer is used for 6 days and dropped by the
# next sweep (every 10 minutes, and on every look at the memory): a day to spare for a sweep that runs late.
FOUND_TTL = 6 * 24 * 3600  # a found video is checked again after that (it may be taken down or blocked)
MISSING_TTL = 24 * 3600    # nothing found: asked again the next day
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
# What a video title says when it is not the song as released. A word the song's own title has ("Remix", "Teaser") does
# not count against it.
NOT_THE_SONG = ["cover", "karaoke", "reaction", "instrumental", "inst", "mr", "1 hour", "loop", "fancam", "fan cam", "tutorial", "sheet music",
                "remix", "sped up", "slowed", "8d", "teaser", "preview", "dance practice", "choreography", "mashup", "medley",
                "커버", "노래방", "리액션", "1시간", "반복", "교차편집", "교차 편집", "직캠", "강좌", "악보", "리믹스", "티저", "미리듣기",
                "미리 듣기", "안무", "메들리"]
HANGUL = re.compile(r"[가-힣]")
# Words that contain a left-out word without being one.
LOOKALIKES = {"커버": ["디스커버", "리커버", "커버리지"], "반복": [], "안무": []}
OFFICIAL = re.compile(r"(?<![a-z])(m/?v|official|audio)(?![a-z])|뮤직\s*비디오", re.IGNORECASE)
PERFORMANCE = re.compile(r"(?<![a-z])(live|concert|stage|performance|show)(?![a-z])|라이브|콘서트|무대|공연|교차", re.IGNORECASE)
LYRICS = re.compile(r"(?<![a-z])lyrics?(?![a-z])|가사", re.IGNORECASE)


def _spelled(word: str) -> str:
    """A pattern for `word`: Korean may be spaced any way ("눈의 꽃", "눈의꽃"); Latin keeps its letters together, and its
    spaces may be any run of spaces ("in St." is not "inst")."""
    if HANGUL.search(word):
        return r"\s*".join(re.escape(c) for c in word.casefold() if not c.isspace())
    return r"\s+".join(re.escape(part) for part in word.casefold().split())


def _bounded(word: str, text: str) -> bool:
    """`word` in `text` standing on its own: not inside a longer word of letters (Latin or Hangul) or digits."""
    pattern = _spelled(word)
    return bool(pattern) and re.search(rf"(?<![0-9a-z가-힣]){pattern}(?![0-9a-z가-힣])", text.casefold()) is not None


def _names(text: str, name: str) -> bool:
    """Whether `text` names `name`: as a word of its own when it is short ("IU" is not in "Premium", "봄날" not in
    "봄날의 기억"), else anywhere once spaces and marks are taken out."""
    plain = norm(name)
    return bool(plain) and (_bounded(name.strip(), text) or (len(plain) > 3 and plain in norm(text)))


# Groups whose videos name them in Latin letters, in addition to the store's list (cli/media.py ALIASES). Only here: the
# store check keeps its own list.
MORE_ALIASES = {
    "방탄소년단": ["BTS"], "블랙핑크": ["BLACKPINK"], "트와이스": ["TWICE"], "세븐틴": ["SEVENTEEN"], "뉴진스": ["NewJeans"], "레드벨벳": ["Red Velvet"],
    "엑소": ["EXO"], "빅뱅": ["BIGBANG"], "아이브": ["IVE"], "르세라핌": ["LE SSERAFIM"], "에스파": ["aespa"], "스트레이 키즈": ["Stray Kids"],
    "투모로우바이투게더": ["TXT", "TOMORROW X TOGETHER"], "샤이니": ["SHINee"], "있지": ["ITZY"], "데이식스": ["DAY6"], "투어스": ["TWS"],
    "엔시티 드림": ["NCT DREAM"], "엔시티 127": ["NCT 127"], "제니": ["JENNIE"], "리사": ["LISA"], "지드래곤": ["G-DRAGON"], "아이들": ["i-dle", "(G)I-DLE"],
    "케이윌": ["K.Will"], "십센치": ["10CM"], "엔플라잉": ["N.Flying"], "보아": ["BoA"], "에이핑크": ["Apink"], "원더걸스": ["Wonder Girls"],
}


def _artist(artist: str, text: str) -> bool:
    return any(_names(text, name) for name in [artist, *ALIASES.get(artist, []), *MORE_ALIASES.get(artist, [])])


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
    return re.sub(r"\s*[\(\[].*?[\)\]]", "", title).strip() or title


def _says(word: str, text: str) -> bool:
    """A Korean word where a word begins, spaced any way and with anything after it ("커버곡", "1시간반복", "교차 편집", but
    not the "커버" in "디스커버리"); a Latin one as a word of its own ("cover" is not in "Discover")."""
    if HANGUL.search(word):
        # Korean compounds put the word anywhere ("여자커버", "1시간반복"): anywhere, but not inside the few words that only
        # contain it ("디스커버리").
        # As written: "안무" is not in "그동안 무엇"; the spaced forms that do occur are in the list.
        found = text.casefold()
        for whole in LOOKALIKES.get(word, []):
            found = re.sub(_spelled(whole), " ", found)  # "디스커버리" and "디스 커버리" alike
        return word.casefold() in found
    return _bounded(word, text)


def _not_the_song(title: str, name: str) -> bool:
    return any(_says(word, name) and not _says(word, title) for word in NOT_THE_SONG)


def _channel_names(channel: str) -> set[str]:
    """What a channel calls itself: the whole name and each part in brackets, without "Official", "공식" or "- Topic"
    ("이지금 [IU Official]" → "이지금 [IU]", "IU")."""
    parts = [channel, *re.findall(r"[\[\(](.*?)[\]\)]", channel)]
    return {norm(re.sub(r"(?i)\bofficial\b|공식|\s-\sTopic$", "", part)) for part in parts} - {""}


def _artists_channel(artist: str, channel: str) -> bool:
    """The artist's own channel (or YouTube's "- Topic" one): its name, or a part of it in brackets, is the artist's name
    and nothing more. A channel that only mentions the name ("아이유 팬 채널", "아이유 팬 Official") is not the artist's."""
    names = {norm(n) for n in [artist, *ALIASES.get(artist, []), *MORE_ALIASES.get(artist, [])]} - {""}
    return bool(names & _channel_names(channel))


def candidates(title: str, artist: str, items: list[dict]) -> list[str]:
    """The search results that are this song, best first, by id. Pure: the search's `items` in, ids out.

    Kept: a video whose title names the song's title (or its usual English one) and whose channel or title names the
    artist. Ranked: the artist's "- Topic" channel, then the artist's own channel, a title naming the artist, an official
    video; a live stage or a lyrics upload after those. Left out: covers, karaoke, dance practice, loops and the like."""
    titles = [t for t in {_core(title), TITLE_ALIASES.get(title, "")} if t]
    scored: list[tuple[int, int, str]] = []
    for order, item in enumerate(items):
        video_id = (item.get("id") or {}).get("videoId", "")
        snippet = item.get("snippet") or {}
        name, channel = html.unescape(snippet.get("title", "")), html.unescape(snippet.get("channelTitle", ""))  # the API sends "&#39;"
        if not VIDEO_ID.match(video_id) or snippet.get("liveBroadcastContent", "none") != "none":
            continue
        if not any(_names(name, t) for t in titles) or _not_the_song(title, name):
            continue
        named, by_title = _artist(artist, channel), _artist(artist, name)
        if not (named or by_title):
            continue  # a song of the same name by someone else
        own = _artists_channel(artist, channel)
        topic = own and channel.endswith(" - Topic")  # YouTube's own channel of the artist's releases
        score = (4 if topic else 3 if own else 0) + (1 if by_title else 0)
        score += (1 if OFFICIAL.search(name) else 0) - (2 if PERFORMANCE.search(name) else 0) - (1 if LYRICS.search(name) else 0)
        scored.append((-score, order, video_id))
    return [video_id for _, _, video_id in sorted(scored)]


def playable(video: dict, region: str = "KR") -> bool:
    """A video the player may show here: embeddable, not age-restricted, not blocked in the region."""
    status, details = video.get("status") or {}, video.get("contentDetails") or {}
    # Made for kids must be known to be false: the API sends it with a key (seen 2026-11-18), and a video whose status
    # does not say is not offered rather than assumed.
    if status.get("embeddable") is not True or status.get("privacyStatus") not in ("public", "unlisted") or status.get("madeForKids") is not False:
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
    """One per process: the key, and the answers it already gave (found and not found) until they are due again. An
    answer past its time is dropped, not only ignored: the API's data is not kept longer than the policy allows. Two
    requests for the same song at once make one search; the second waits for the first's answer."""

    def __init__(self, key: str, get: Getter = _get, timeout_s: float = 4.0, cache_size: int = 2000, now: Callable[[], float] = time.monotonic,
                 sweep_every_s: float | None = None):
        self.key, self.get, self.timeout_s, self.cache_size, self.now = key, get, timeout_s, cache_size, now
        self.kept: OrderedDict[tuple[str, str], _Kept] = OrderedDict()
        self.asking: dict[tuple[str, str], threading.Event] = {}
        self.lock = threading.Lock()
        if sweep_every_s:
            # Answers are dropped on time even when nobody asks for a video for a long while (the policy's limit is on
            # keeping, not on using). A daemon thread: it ends with the process.
            def sweeper() -> None:
                while True:
                    time.sleep(sweep_every_s)
                    try:
                        with self.lock:
                            self._sweep()
                    except Exception:  # noqa: BLE001 - one failed sweep must not end the sweeping
                        log.exception("youtube: sweep failed")

            threading.Thread(target=sweeper, name="youtube-sweep", daemon=True).start()

    def _sweep(self) -> None:
        """Drops every answer past its time. Called under the lock; the cache holds at most `cache_size` entries."""
        now = self.now()
        for song in [song for song, kept in self.kept.items() if kept.until <= now]:
            del self.kept[song]

    def known(self, title: str, artist: str) -> tuple[bool, str | None]:
        """(True, answer) when this song was asked about recently; the answer may be None (no video)."""
        with self.lock:
            self._sweep()
            kept = self.kept.get((title, artist))
            return (True, kept.video_id) if kept else (False, None)

    def lookup(self, title: str, artist: str, charge: Callable[[], None]) -> str | None:
        """The answer from memory, or a search. `charge` is called once before a search is made (it counts the search, and
        may raise to refuse it); a request that finds another already asking waits for that one instead of searching."""
        song = (title, artist)
        with self.lock:
            self._sweep()
            if song in self.kept:
                return self.kept[song].video_id
            waiting = self.asking.get(song)
            if waiting is None:
                self.asking[song] = threading.Event()
        if waiting is not None:
            waiting.wait(self.timeout_s * 2 + 1)
            seen, answer = self.known(title, artist)
            if not seen:
                raise YouTubeUnavailable("the search asked at the same time did not answer")
            return answer
        try:
            charge()
            return self.find(title, artist)
        finally:
            with self.lock:
                self.asking.pop(song).set()

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
            # The key never goes to the log: it travels in a header, and only the kind of failure is kept.
            raise YouTubeUnavailable(type(error).__name__ + (f" {error.response.status_code}" if isinstance(error, httpx.HTTPStatusError) else "")) from None
        with self.lock:
            self._sweep()
            self.kept[(title, artist)] = _Kept(video_id, self.now() + (FOUND_TTL if video_id else MISSING_TTL))
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
            _finder = YouTubeFinder(key, sweep_every_s=600)
        return _finder

"""Is an AI song listed on Apple's store? Asked by the server before the answer goes out (2026-11-10).

The model names songs from memory and is sure of nearly all of them, wrong ones included: 16 of 110 songs were not listed
in the evaluation of 2026-11-10 ("첫 만남은 계획대로 되지 않아 - QWER" is TWS's), every one marked "high". So the model is
asked for a couple of spare songs and the listed ones go first (llm/free.validate_free `rank`).

One door, chosen for the request budget (the store allows about 20 requests a minute per address): the US song search with
"artist title" in the model's own words. That search matches Korean titles too, but answers with the store's English names
("너의 의미" comes back as "Meaning of You"), so when no hit matches on those, the hits are looked up once more in the Korean
store by id (one request for the whole answer), which gives the Korean names. Measured 2026-11-10: the eval lookup and the
browser (src/songCheck.ts) both missed "사랑은 은하수 다방에서 - 10CM" for this reason.

Not listed does not prove a song does not exist. A song that could not be asked (budget, deadline, an error) is "unknown"
and keeps its place between the listed and the unlisted ones; the answer never waits longer than `deadline_s` for the store.
"""
import logging
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Protocol

import httpx

from .cli.media import artist_matches, title_matches

log = logging.getLogger(__name__)

FOUND, MISSING, UNKNOWN = "found", "missing", "unknown"
ORDER = {FOUND: 0, UNKNOWN: 1, MISSING: 2}
Getter = Callable[[str, dict, float], list[dict]]


class Song(Protocol):
    name: str
    detail: str
    listed: str | None


# Kept-alive connections: a fresh TLS connection per request cost 0.3-0.5s more per answer (measured 2026-11-10).
_client = httpx.Client(headers={"User-Agent": "nowrecommend-api/0.1"}, limits=httpx.Limits(max_connections=16, max_keepalive_connections=8, keepalive_expiry=60))


def _get(path: str, params: dict, timeout: float) -> list[dict]:
    response = _client.get(f"https://itunes.apple.com/{path}", params=params, timeout=timeout)
    response.raise_for_status()
    return response.json().get("results", [])


def _matches(title: str, artist: str, hit: dict, also: dict | None = None) -> bool:
    """`also`: the same track in the other store, whose artist name counts too ("IU" there, "아이유" here)."""
    names = [hit.get("artistName", ""), *([also.get("artistName", "")] if also else [])]
    return bool(hit.get("trackName")) and title_matches(title, hit["trackName"]) and any(artist_matches(artist, n) for n in names)


class SongStore:
    """Shared by the requests of one process: the budget, a pause after the store refuses, and the answers it already gave."""

    def __init__(self, get: Getter = _get, per_minute: int = 18, deadline_s: float = 1.5, pause_s: float = 120.0, cache_size: int = 2000,
                 clock: Callable[[], float] = time.monotonic):
        self.get, self.per_minute, self.deadline_s, self.pause_s, self.cache_size, self.clock = get, per_minute, deadline_s, pause_s, cache_size, clock
        self._sent: deque[float] = deque()
        self._paused_until = 0.0
        self._cache: OrderedDict[tuple[str, str], str] = OrderedDict()
        self._lock = threading.Lock()

    def _take(self, wanted: int) -> int:
        """Requests the rolling minute still allows, up to `wanted`; they count as sent."""
        with self._lock:
            now = self.clock()
            while self._sent and now - self._sent[0] >= 60:
                self._sent.popleft()
            granted = 0 if now < self._paused_until else max(0, min(wanted, self.per_minute - len(self._sent)))
            self._sent.extend([now] * granted)
            return granted

    def _ask(self, path: str, params: dict, timeout: float) -> list[dict]:
        try:
            return self.get(path, params, timeout)
        except Exception as exc:
            code = getattr(exc, "code", None) or getattr(getattr(exc, "response", None), "status_code", None)
            if code in (403, 429):  # the store asks callers to slow down
                with self._lock:
                    self._paused_until = self.clock() + self.pause_s
                log.warning("song store refused (%s); pausing checks for %.0fs", code, self.pause_s)
            raise

    def _remember(self, key: tuple[str, str], status: str) -> None:
        with self._lock:
            self._cache[key] = status
            self._cache.move_to_end(key)
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)

    def check(self, songs: Sequence[tuple[str, str]]) -> list[str]:
        """FOUND, MISSING or UNKNOWN for each (title, artist), in the same order."""
        started = self.clock()
        keys = [(t.strip(), a.strip()) for t, a in songs]
        with self._lock:
            status = {k: self._cache[k] for k in keys if k in self._cache}
        todo = [k for k in dict.fromkeys(keys) if k not in status]
        todo = todo[:self._take(len(todo))]
        if todo:
            settled, open_hits = self._search(todo, started)
            settled |= self._korean_names(open_hits, started)
            for key, value in settled.items():
                status[key] = value
                self._remember(key, value)
        return [status.get(k, UNKNOWN) for k in keys]

    def _search(self, todo: list[tuple[str, str]], started: float) -> tuple[dict[tuple[str, str], str], dict[tuple[str, str], list[dict]]]:
        """The US search for every song at once: the songs it settles, and the open ones with their hits."""
        pool = ThreadPoolExecutor(max_workers=len(todo))
        futures = {pool.submit(self._ask, "search", {"term": f"{a} {t}", "country": "US", "entity": "song", "limit": 10}, self.deadline_s): (t, a)
                   for t, a in todo}
        done, _ = wait(futures, timeout=max(0.0, self.deadline_s - (self.clock() - started)))
        pool.shutdown(wait=False, cancel_futures=True)
        settled: dict[tuple[str, str], str] = {}
        open_hits: dict[tuple[str, str], list[dict]] = {}
        for future in done:
            key = futures[future]
            try:
                hits = future.result()
            except Exception as exc:  # OSError, HTTPError, bad JSON: not known, not missing
                log.info("song store search failed: %s", type(exc).__name__)
                continue
            if any(_matches(*key, h) for h in hits):
                settled[key] = FOUND
            elif hits:
                open_hits[key] = hits
            else:
                settled[key] = MISSING
        return settled, open_hits

    def _korean_names(self, open_hits: dict[tuple[str, str], list[dict]], started: float) -> dict[tuple[str, str], str]:
        """One lookup by id in the Korean store for every open song. A song that cannot be asked stays out (unknown)."""
        ids = list(dict.fromkeys(h["trackId"] for hits in open_hits.values() for h in hits if h.get("trackId")))
        left = self.deadline_s - (self.clock() - started)
        if not ids or left <= 0.05 or not self._take(1):
            return {}
        try:
            korean = {h.get("trackId"): h for h in self._ask("lookup", {"id": ",".join(map(str, ids)), "country": "KR"}, left)}
        except Exception as exc:
            log.info("song store lookup failed: %s", type(exc).__name__)
            return {}
        return {key: FOUND if any(_matches(*key, korean[h["trackId"]], h) for h in hits if h.get("trackId") in korean) else MISSING
                for key, hits in open_hits.items()}

    def rank(self, picks: list[Song]) -> list[Song]:
        """Listed songs first, then unknown, then unlisted; the model's order within each. Sets `listed` on every pick."""
        for pick, status in zip(picks, self.check([(p.name, p.detail) for p in picks]), strict=True):
            pick.listed = status
        return sorted(picks, key=lambda p: ORDER[p.listed or UNKNOWN])


_shared: SongStore | None = None


def song_store() -> SongStore | None:
    """The process's checker, or None when SONG_STORE_CHECK is off (tests, or when the store misbehaves)."""
    from .config import get_settings

    global _shared
    settings = get_settings()
    if not settings.song_store_check:
        return None
    if _shared is None:
        _shared = SongStore(per_minute=settings.song_store_per_minute, deadline_s=settings.song_store_deadline_ms / 1000)
    return _shared

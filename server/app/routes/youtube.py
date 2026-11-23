"""GET /api/youtube/{item_id}: the video to play a song in its details (app/youtube.py, 2026-11-18).

The song is named by its id, never by words from the browser: only songs the service knows (the catalog and what the
model named, both in `items`) are looked for, so nobody can spend the search quota on searches of their own. A song asked
about recently answers from memory and counts against nothing; a new search counts against the caller's day and the
service's day (usage_daily), checked before the API is asked.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..budget import Allowance, guest_key
from ..config import Settings, get_settings
from ..db import get_session
from ..models import Item
from ..ratelimit import client_address
from ..stats import count
from ..youtube import YouTubeFinder, YouTubeUnavailable, youtube_finder

log = logging.getLogger(__name__)
router = APIRouter()
OFF = "지금은 YouTube 플레이어를 쓸 수 없어요. 아래 'YouTube에서 찾기'로 열어 주세요."
BUSY = "오늘은 YouTube 플레이어를 더 열 수 없어요. 'YouTube에서 찾기'로 열어 주세요."


def find_song(item_id: str, session: Session = Depends(get_session)) -> tuple[str, str] | None:
    """(title, artist) of a song the service knows, or None."""
    item = session.get(Item, item_id) if len(item_id) <= 80 else None
    if item is None or item.category != "music" or item.status == "rejected":
        return None
    return item.name, (item.artist or item.subtitle or "")


@router.get("/api/youtube/{item_id}")
def video(request: Request, song: tuple[str, str] | None = Depends(find_song), session: Session = Depends(get_session),
          settings: Settings = Depends(get_settings), finder: YouTubeFinder | None = Depends(youtube_finder)):
    if finder is None or settings.youtube_daily_limit <= 0:  # no key, or YOUTUBE_DAILY_LIMIT=0: the player is off
        raise HTTPException(503, OFF)
    if song is None:
        raise HTTPException(404, "곡을 찾지 못했어요.")
    title, artist = song

    def charge() -> None:
        """Counts a new search against the caller's day and the service's, or refuses it."""
        mine = Allowance(session, f"yt:g:{guest_key(client_address(request, settings.trust_proxy), settings.auth_secret)}", settings.youtube_daily_per_address, False)
        everyone = Allowance(session, "yt:all", settings.youtube_daily_limit, False)
        if not mine.take():
            raise HTTPException(429, BUSY)
        if not everyone.take():
            mine.give_back()
            log.warning("youtube: the service's daily searches (YOUTUBE_DAILY_LIMIT) are used up")
            raise HTTPException(429, BUSY)

    try:
        # Counted all the same when the search fails: the API may have counted it before failing.
        found = {"videoId": finder.lookup(title, artist, charge)}
        count(session, "youtube")  # for the admin dashboard (stats.py)
        return found
    except YouTubeUnavailable as error:
        log.warning("youtube: search failed: %s", error)
        raise HTTPException(503, OFF) from None

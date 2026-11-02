"""AI picks as catalog items (2026-11-02).

A song or dish the model named gets a row in `items` (status draft, source ai_draft, id `ai-<hash>`), so later requests
can turn its id back into a label (seen, pinned, disliked, liked), the browser keeps the same id across sessions, and a
pick that already exists in the catalog (by name and artist) reuses that item, cover and all. Drafts never reach
/api/catalog or the retrieval pipeline, and app.cli.review skips them (they are not written for a reviewer).
"""
import hashlib

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .catalog import trait_summary
from .llm.free import FreePick, pick_key
from .models import Item
from .vocab import get_vocab

AI_PICK_PREFIX = "ai-"
AI_PICK_NOTE = "AI 추천 결과로 자동 저장된 항목(검수 대상 아님)"
EMOJI = {"music": "🎵", "food": "🍽️"}
COLOR = {"music": "#e6dfef", "food": "#f4e9d9"}


def ai_item_id(category: str, name: str, detail: str) -> str:
    return AI_PICK_PREFIX + hashlib.sha1(f"{category}|{pick_key(name, detail)}".encode("utf-8")).hexdigest()[:14]


def is_ai_pick(item_id: str) -> bool:
    return item_id.startswith(AI_PICK_PREFIX)


def item_label(row: Item) -> str:
    """'name - artist' for songs, the name for dishes: the format the free prompt's taste/avoid lists use."""
    return f"{row.name} - {row.artist}" if row.artist else row.name


def labels_for(session: Session, ids: list[str], category: str) -> list[str]:
    if not ids:
        return []
    rows = session.scalars(select(Item).where(Item.id.in_(ids), Item.category == category)).all()
    order = {i: n for n, i in enumerate(ids)}
    return [item_label(r) for r in sorted(rows, key=lambda r: order[r.id])]


def find_existing(session: Session, category: str, name: str, detail: str) -> Item | None:
    """The catalog row with the same name (and artist, for music): the AI picked something we already know."""
    query = select(Item).where(Item.category == category, func.lower(Item.name) == name.lower(), Item.status != "rejected")
    if category == "music":
        query = query.where(func.coalesce(func.lower(Item.artist), "") == detail.lower())
    rows = session.scalars(query.order_by(Item.status.desc())).all()  # 'reviewed' sorts after 'draft': prefer it
    reviewed = [r for r in rows if r.status == "reviewed"]
    return (reviewed or rows or [None])[0]


def persist_picks(session: Session, category: str, picks: list[FreePick]) -> list[Item]:
    """One row per pick, in order: an existing catalog row when the name matches, else a new or reused AI draft."""
    rows: list[Item] = []
    vocab = get_vocab().for_category(category)
    for pick in picks:
        row = find_existing(session, category, pick.name, pick.detail) or session.get(Item, ai_item_id(category, pick.name, pick.detail))
        if row is None:
            tags = [t for t in pick.tags if t in vocab.tags]
            row = Item(id=ai_item_id(category, pick.name, pick.detail), category=category, name=pick.name,
                       artist=pick.detail if category == "music" else None,
                       subtitle=pick.detail if category == "music" else (trait_summary(tags, vocab.extraTags) if tags else pick.detail or "음식"),
                       description=f"AI가 직접 고른 {'곡' if category == 'music' else '메뉴'}예요. 실제 정보는 검색으로 확인해주세요.",
                       tags=tags, ingredients=[], emoji=EMOJI[category], color=COLOR[category],
                       status="draft", source="ai_draft", ai_fields=["name", "subtitle", "tags"], review_notes=[AI_PICK_NOTE])
            session.add(row)
        rows.append(row)
    try:
        session.commit()
    except Exception:  # A collision on the unique name index or a lost connection: the answer still goes out.
        session.rollback()
        rows = [find_existing(session, category, p.name, p.detail) or _detached(category, p) for p in picks]
    return rows


def _detached(category: str, pick: FreePick) -> Item:
    """An unsaved row for the response when the insert failed; the id is still the stable hash."""
    return Item(id=ai_item_id(category, pick.name, pick.detail), category=category, name=pick.name, artist=pick.detail if category == "music" else None,
                subtitle=pick.detail or "음식", description="AI가 직접 고른 항목이에요.", tags=list(pick.tags), ingredients=[],
                emoji=EMOJI[category], color=COLOR[category], status="draft", source="ai_draft", ai_fields=[], review_notes=[])

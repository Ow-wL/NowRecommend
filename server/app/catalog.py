"""Catalog access: validation, seeding, embedding refresh and the public item shape."""
import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .embeddings import Embedder, document_text, embedding_hash
from .models import Item
from .vocab import Vocab, get_vocab

SEED_FILE = Path(__file__).resolve().parents[1] / "data" / "seed_items.json"
# Approved AI drafts (app.cli.review publish), loaded by app.cli.seed after the bundled seed so a fresh DB gets them too.
REVIEWED_FILE = Path(__file__).resolve().parents[1] / "data" / "reviewed_items.json"
SOURCES = ("seed", "ai_draft", "user_request")
CONTENT_FIELDS = ("category", "name", "artist", "subtitle", "description", "tags", "ingredients", "emoji", "color")
# A food item's second line: its checkable traits, never a price (traitSummary in src/data.ts).
TRAITS = ("매콤함", "담백함", "고소함", "상큼함", "따뜻함", "차가움", "국물", "채소")


def trait_summary(tags: list[str], extra_tags: list[str]) -> str:
    return " · ".join([t for t in TRAITS if t in tags][:3]) or next((t for t in tags if t in extra_tags), "음식")


def validate_item(vocab: Vocab, item: dict) -> list[str]:
    """Same checks as validateCatalog in src/data.ts, so the DB never holds tags the UI cannot show."""
    label = item.get("id") or "?"
    errors: list[str] = []
    if item.get("category") not in ("food", "music"):
        return [f"분야: {label}"]
    for key in ("id", "name", "subtitle", "description", "emoji", "color"):
        if not isinstance(item.get(key), str) or not item[key].strip():
            errors.append(f"필수 필드 {key}: {label}")
    tags = item.get("tags") or []
    if not tags or set(tags) - vocab.for_category(item["category"]).tags:
        errors.append(f"태그: {label}")
    # Every recorded ingredient must be excludable, or "참깨는 빼줘" would match nothing (validateCatalog in src/data.ts).
    if item["category"] == "food" and (unknown := set(item.get("ingredients") or []) - set(vocab.food.excludableIngredients)):
        errors.append(f"제외 어휘에 없는 재료 {sorted(unknown)}: {label}")
    if item["category"] == "music" and not item.get("artist"):
        errors.append(f"아티스트: {label}")
    return errors


def load_seed(path: Path = SEED_FILE) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["items"]


def published_items(session: Session) -> dict:
    """Reviewed items that did not come from the bundled seed, in the seed file shape plus their source."""
    rows = session.scalars(select(Item).where(Item.status == "reviewed", Item.source != "seed").order_by(Item.category, Item.id))
    return {"items": [{"id": r.id, **{k: getattr(r, k) for k in CONTENT_FIELDS}, "source": r.source} for r in rows]}


@dataclass
class SeedResult:
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0


def seed_items(session: Session, vocab: Vocab, items: list[dict]) -> SeedResult:
    errors = [e for item in items for e in validate_item(vocab, item)]
    errors += [f"출처: {i.get('id')}" for i in items if i.get("source", "seed") not in SOURCES]
    if errors:
        raise ValueError("시드 검증 실패: " + ", ".join(errors))
    existing = {row.id: row for row in session.scalars(select(Item).where(Item.id.in_([i["id"] for i in items])))}
    result = SeedResult()
    for item in items:
        values = {k: item.get(k) for k in CONTENT_FIELDS}
        old = existing.get(item["id"])
        if old is not None and old.status == "reviewed" and all(getattr(old, k) == v for k, v in values.items()):
            result.unchanged += 1
            continue
        statement = insert(Item).values(id=item["id"], status="reviewed", source=item.get("source", "seed"), reviewed_at=func.now(), **values)
        session.execute(statement.on_conflict_do_update(
            index_elements=[Item.id],
            set_={**values, "status": "reviewed", "reviewed_at": func.now(), "updated_at": func.now()},
        ))
        if old is None:
            result.inserted += 1
        else:
            result.updated += 1
    session.commit()
    return result


def retire_unpublished(session: Session, published_ids: Iterable[str]) -> list[str]:
    """Reviewed non-seed items missing from reviewed_items.json are taken out of the catalog ('rejected'), so
    removing an item from the published file also removes it from a deployed DB that already has it."""
    keep = set(published_ids)
    rows = [r for r in session.scalars(select(Item).where(Item.status == "reviewed", Item.source != "seed")) if r.id not in keep]
    for row in rows:
        row.status = "rejected"
        row.review_notes = [*row.review_notes, "reviewed_items.json에서 빠져 카탈로그에서 내림"]
    session.commit()
    return [r.id for r in rows]


def refresh_embeddings(session: Session, embedder: Embedder, force: bool = False, dry_run: bool = False) -> list[str]:
    """Embed reviewed items whose text, model or dimension changed. Returns the ids that were (or would be) embedded."""
    rows = session.scalars(select(Item).where(Item.status == "reviewed").order_by(Item.id)).all()
    pending = []
    for row in rows:
        text = document_text(row)
        digest = embedding_hash(embedder.model, embedder.dim, text)
        if force or row.embedding is None or row.embedding_hash != digest:
            pending.append((row, text, digest))
    if dry_run or not pending:
        return [row.id for row, _, _ in pending]
    vectors = embedder.embed([text for _, text, _ in pending])
    for (row, _, digest), vector in zip(pending, vectors, strict=True):
        row.embedding, row.embedding_model, row.embedding_hash = vector, embedder.model, digest
    session.commit()
    return [row.id for row, _, _ in pending]


def reviewed_items(session: Session, category: str | None = None) -> list[Item]:
    query = select(Item).where(Item.status == "reviewed").order_by(Item.category, Item.id)
    if category:
        query = query.where(Item.category == category)
    return list(session.scalars(query))


def public_item(row: Item) -> dict:
    """The frontend Item shape (src/data.ts). No price: food shows its traits as the subtitle."""
    item = {k: getattr(row, k) for k in ("id", "category", "name", "subtitle", "description", "tags", "ingredients", "emoji", "color")}
    if row.category == "food":
        item["subtitle"] = trait_summary(list(row.tags), get_vocab().food.extraTags)
    return item


def catalog_version(items: Iterable[dict]) -> str:
    """Content hash of the whole reviewed catalog; recorded with history rounds."""
    payload = json.dumps(sorted(items, key=lambda i: i["id"]), ensure_ascii=False, sort_keys=True)
    return "db-" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]

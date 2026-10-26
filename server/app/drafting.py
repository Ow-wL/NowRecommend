"""AI-drafted catalog items and their human review (plans-rag.md §7).

names file → draft_items (AI fills fields, status 'draft') → export_review (JSON for a person)
→ import_review (approve / reject; food needs allergensChecked) → reviewed items get embeddings.
Only 'reviewed' items are ever recommended or listed by /api/catalog.
"""
import csv
import time
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .catalog import refresh_embeddings, trait_summary, validate_item
from .embeddings import Embedder, document_text, embedding_hash
from .llm.client import CoolingDown, JsonModel
from .llm.draft import DraftInput, clean_draft, request_drafts
from .models import Item
from .vocab import Vocab

AI_FIELDS = {"food": ["description", "tags", "ingredients", "emoji", "color"],
             "music": ["description", "tags", "emoji", "color"]}
# Measured in R6 with gemini-embedding-2/768 (plans-rag.md §7): true duplicates 0.91–0.98
# (Spring Day ↔ 봄날 0.912, 닭 곰탕 ↔ 닭곰탕 0.984), different-but-related items ≤ 0.866
# (물냉면 ↔ 메밀국수). The planned 0.95 missed the English-title duplicate.
DUPLICATE_THRESHOLD = 0.90
ALLERGEN_RULE = "음식은 재료(ingredients)의 알레르기 재료를 확인하고 allergensChecked를 true로 바꿔야 승인돼요."


def normalize(text: str | None) -> str:
    return "".join((text or "").lower().split())


def read_inputs(path: Path, category: str) -> list[DraftInput]:
    """.txt: one per line ('제목 - 아티스트' for music, '#' comments). .csv: columns name[,artist]."""
    if path.suffix.lower() == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as handle:
            rows = [(r.get("name") or r.get("title") or "", r.get("artist")) for r in csv.DictReader(handle)]
    else:
        rows = []
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            name, _, artist = line.rpartition(" - ") if category == "music" and " - " in line else (line, "", None)
            rows.append((name, artist))
    inputs, seen = [], set()
    for name, artist in rows:
        entry = DraftInput(" ".join(name.split()), " ".join(artist.split()) if artist and category == "music" else None)
        key = (normalize(entry.name), normalize(entry.artist))
        if entry.name and key not in seen:
            seen.add(key)
            inputs.append(entry)
    return inputs


@dataclass
class DraftReport:
    created: list[str] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)
    embedded: bool = False


def _request_with_retry(model: JsonModel, category: str, batch: list[DraftInput], vocab, retries: int, wait: float, sleep=time.sleep) -> list:
    """An overloaded model (503) or its cooldown is usually over in seconds; a spent quota (429) is not, so only
    the former is retried. Without this one 503 also skipped the next batches while the cooldown lasted (R6 rerun)."""
    for attempt in range(retries + 1):
        try:
            return request_drafts(model, category, batch, vocab)
        except Exception as exc:
            overloaded = getattr(exc, "code", None) == 503 or (isinstance(exc, CoolingDown) and not exc.quota)
            if attempt == retries or not overloaded:
                raise
            sleep(wait)
    return []


def draft_items(session: Session, model: JsonModel, embedder: Embedder | None, vocab: Vocab, category: str,
                inputs: list[DraftInput], batch_size: int = 10, retries: int = 0, retry_wait: float = 15.0) -> DraftReport:
    report = DraftReport()
    existing = {(normalize(r.name), normalize(r.artist)) for r in session.scalars(select(Item).where(Item.category == category))}
    todo = []
    for entry in inputs:
        if (normalize(entry.name), normalize(entry.artist)) in existing:
            report.skipped.append((entry.label, "이미 카탈로그에 있음"))
        else:
            todo.append(entry)
    category_vocab = vocab.for_category(category)
    created: list[Item] = []
    for start in range(0, len(todo), batch_size):
        batch = todo[start:start + batch_size]
        try:
            answers = _request_with_retry(model, category, batch, category_vocab, retries, retry_wait)
        except Exception as exc:  # quota, overload, timeout: report and keep going with the next batch
            code = getattr(exc, "code", None)  # 429 = quota spent (free tier ~20/day), 503 = overloaded
            reason = f"모델 오류: {type(exc).__name__}" + (f" {code}" if code else "")
            report.skipped += [(entry.label, reason) for entry in batch]
            continue
        by_input = {a.get("input"): a for a in answers if isinstance(a, dict)}
        for entry in batch:
            item, notes, error = clean_draft(category, entry, by_input.get(entry.label), category_vocab)
            item_id = f"{category[0]}-{uuid.uuid4().hex[:8]}"
            if item is not None and (problems := validate_item(vocab, {**item, "id": item_id})):
                error = ", ".join(problems)
            if error:
                report.skipped.append((entry.label, error))
                continue
            row = Item(id=item_id, status="draft", source="ai_draft", ai_fields=AI_FIELDS[category], review_notes=notes, **item)
            session.add(row)
            created.append(row)
        session.commit()
    report.created = [r.id for r in created]
    if embedder and created:
        # Embedded now so the review export can flag near-duplicates; approval re-embeds only if text changes.
        try:
            texts = [document_text(r) for r in created]
            for row, text, vector in zip(created, texts, embedder.embed(texts), strict=True):
                row.embedding, row.embedding_model, row.embedding_hash = vector, embedder.model, embedding_hash(embedder.model, embedder.dim, text)
            session.commit()
            report.embedded = True
        except Exception:
            session.rollback()
    return report


def similar_items(row: Item, others: Iterable[Item], threshold: float = DUPLICATE_THRESHOLD) -> list[str]:
    """Warnings, not blocks: same/contained names (우동 ↔ 가케우동) and embedding cosine ≥ threshold."""
    warnings = []
    name = normalize(row.name)
    vector = None if row.embedding is None else np.asarray(row.embedding, dtype=float)
    for other in others:
        if other.id == row.id or other.category != row.category or other.status == "rejected":
            continue
        other_name = normalize(other.name)
        same_artist = row.category == "food" or normalize(other.artist) == normalize(row.artist)
        if same_artist and min(len(name), len(other_name)) >= 2 and (name in other_name or other_name in name):
            warnings.append(f"이름이 비슷한 항목: {other.name} ({other.id}, {other.status})")
        elif vector is not None and other.embedding is not None:
            similarity = float(vector @ np.asarray(other.embedding, dtype=float))
            if similarity >= threshold:
                warnings.append(f"내용이 비슷한 항목: {other.name} ({other.id}, {other.status}) 유사도 {similarity:.2f}")
    return warnings


def export_review(session: Session, category: str | None = None, threshold: float = DUPLICATE_THRESHOLD) -> dict:
    query = select(Item).order_by(Item.category, Item.created_at, Item.id)
    everything = list(session.scalars(query))
    drafts = [r for r in everything if r.status == "draft" and (category is None or r.category == category)]
    entries = []
    for row in drafts:
        entry = {"id": row.id, "category": row.category, "name": row.name, "artist": row.artist, "description": row.description,
                 "tags": list(row.tags), "emoji": row.emoji, "color": row.color, "aiFields": list(row.ai_fields),
                 "notes": [*row.review_notes, *similar_items(row, everything, threshold)], "decision": "pending"}
        if row.category == "food":
            entry |= {"ingredients": list(row.ingredients), "allergensChecked": False}
        entries.append(entry)
    return {"exportedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "instructions": ["decision을 approve(승인)·reject(제외)·pending(보류) 중 하나로 바꿔요.",
                             "설명·태그·재료·이모지·색은 고쳐도 돼요. 태그는 shared/vocab.json 어휘만 쓸 수 있어요.",
                             ALLERGEN_RULE, "notes의 경고(비슷한 항목, 모르는 곡)를 확인해요. 경고만으로 막지는 않아요."],
            "items": entries}


@dataclass
class ImportReport:
    approved: list[str] = field(default_factory=list)
    rejected: list[str] = field(default_factory=list)
    pending: int = 0
    errors: list[tuple[str, str]] = field(default_factory=list)
    embedded: list[str] = field(default_factory=list)


def import_review(session: Session, vocab: Vocab, data: dict, embedder: Embedder | None) -> ImportReport:
    report = ImportReport()
    for entry in data.get("items") or []:
        item_id = entry.get("id") if isinstance(entry, dict) else None
        row = session.get(Item, item_id) if isinstance(item_id, str) else None
        decision = entry.get("decision") if isinstance(entry, dict) else None
        if row is None:
            report.errors.append((str(item_id), "없는 항목"))
        elif decision == "pending":
            report.pending += 1
        elif row.status != "draft":
            report.errors.append((row.id, f"검수 대상이 아님 (현재 {row.status})"))  # a stale file never overwrites
        elif decision == "reject":
            row.status, row.reviewed_at = "rejected", func.now()
            report.rejected.append(row.id)
        elif decision != "approve":
            report.errors.append((row.id, f"알 수 없는 decision: {decision!r}"))
        elif error := _approve(session, vocab, row, entry):
            report.errors.append((row.id, error))
        else:
            report.approved.append(row.id)
    session.commit()
    if embedder and report.approved:
        report.embedded = refresh_embeddings(session, embedder)
    return report


def _approve(session: Session, vocab: Vocab, row: Item, entry: dict) -> str | None:
    if row.category == "food" and entry.get("allergensChecked") is not True:
        return ALLERGEN_RULE
    fields = {"category": row.category, "name": entry.get("name"), "artist": entry.get("artist") if row.category == "music" else None,
              "description": entry.get("description"), "tags": entry.get("tags"), "emoji": entry.get("emoji"), "color": entry.get("color"),
              "ingredients": (entry.get("ingredients") or []) if row.category == "food" else []}
    if not isinstance(fields["tags"], list) or not isinstance(fields["ingredients"], list):
        return "tags·ingredients는 목록이어야 해요"
    fields["subtitle"] = trait_summary(fields["tags"], vocab.food.extraTags) if row.category == "food" else fields["artist"]
    if errors := validate_item(vocab, {**fields, "id": row.id}):
        return ", ".join(errors)
    key = (normalize(fields["name"]), normalize(fields["artist"]))
    clash = next((o for o in session.scalars(select(Item).where(Item.category == row.category, Item.id != row.id))
                  if (normalize(o.name), normalize(o.artist)) == key), None)
    if clash:
        return f"같은 이름이 이미 있음: {clash.name} ({clash.id})"
    for name, value in fields.items():
        setattr(row, name, value)
    row.status, row.reviewed_at = "reviewed", func.now()
    return None

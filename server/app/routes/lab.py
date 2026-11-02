"""Lab endpoints for comparing recommendation styles (plans-music-ai.md). Not used by the main flow.

A = the catalog pipeline (POST /api/recommend with engine "catalog"), B = free AI picks (POST /api/lab/{category}/free).
Since 2026-11-02 both categories can be compared; music's main flow already uses the free picks (app/ai_engine.py).
"""
import logging
import time
import uuid
from collections import Counter
from datetime import datetime, timezone
from functools import lru_cache
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy.orm import Session

from ..ai_items import labels_for, persist_picks
from ..catalog import public_item
from ..config import get_settings
from ..db import get_session
from ..llm.client import JsonModel
from ..llm.free import build_payload, recommend_free, validate_free
from ..llm.provider import model_named
from ..parsing.rules import situation_text
from ..schemas import Conditions, Profile
from ..vocab import get_vocab

log = logging.getLogger(__name__)
router = APIRouter()

# "name - detail" built from names of up to 80 characters each (llm/free.py NAME_LIMIT).
Label = Annotated[str, StringConstraints(min_length=1, max_length=170)]
Category = Literal["food", "music"]


class FreeRequest(BaseModel):
    raw: Annotated[str, StringConstraints(max_length=300)] = ""
    conditions: Conditions = Conditions()
    profile: Profile = Profile()
    likedText: Annotated[list[Annotated[str, StringConstraints(min_length=1, max_length=60)]], Field(max_length=10)] = []
    avoid: Annotated[list[Label], Field(max_length=60)] = []  # 'name - detail' labels already shown in this request
    count: Annotated[int, Field(ge=1, le=5)] = 5
    model: Annotated[str, StringConstraints(max_length=60)] | None = None  # one of LAB_FREE_MODELS; None = the first

    def check_vocabulary(self, category: str) -> None:
        vocab = get_vocab().for_category(category)
        unknown = (set(self.conditions.tags) | set(self.profile.tags)) - vocab.tags
        unknown |= set(self.conditions.excluded) - set(vocab.exclusions)
        if unknown:
            raise HTTPException(422, f"알 수 없는 조건: {sorted(unknown)}")


def get_free_models() -> dict[str, JsonModel]:
    """Allowed lab models by name. model_named shares each object with rerank and parsing, so a 429 seen
    anywhere pauses every caller of that model."""
    settings = get_settings()
    if not settings.rerank_enabled:
        return {}
    return {name: model for name in settings.lab_free_models if (model := model_named(name)) is not None}


@router.get("/api/lab/models")
@router.get("/api/lab/music/models")  # the first lab's address
def free_models(models: dict[str, JsonModel] = Depends(get_free_models)):
    return {"models": list(models)}


class DailyCap:
    """Per-model call counts for the current UTC day, in process memory (the API runs as one instance)."""

    def __init__(self, today=lambda: datetime.now(timezone.utc).date()):
        self.today, self.day, self.counts = today, None, Counter()

    def take(self, name: str, limit: int) -> bool:
        if self.day != self.today():
            self.day, self.counts = self.today(), Counter()
        if limit and self.counts[name] >= limit:
            return False
        self.counts[name] += 1
        return True


@lru_cache
def get_daily_cap() -> DailyCap:
    return DailyCap()


@router.post("/api/lab/{category}/free")
def free_route(category: Category, request: FreeRequest, session: Session = Depends(get_session),
               models: dict[str, JsonModel] = Depends(get_free_models), cap: DailyCap = Depends(get_daily_cap)):
    started = time.perf_counter()
    request.check_vocabulary(category)
    if request.model is not None and models and request.model not in models:
        raise HTTPException(422, f"사용할 수 없는 모델: {request.model}")
    name = request.model or next(iter(models), None)
    model = models.get(name) if name else None
    liked, disliked = labels_for(session, request.profile.selected, category), labels_for(session, request.profile.disliked, category)
    meta = {"mode": "free", "category": category, "requestId": str(uuid.uuid4()), "model": model.model if model else None, "ai": "off", "issues": None}
    results: list[dict] = []
    if model is not None and name != next(iter(models)) and not cap.take(name, get_settings().lab_extra_model_daily_limit):
        meta["ai"], meta["issues"] = "failed", "daily_limit"
    elif model is not None:
        meta["ai"] = "failed"
        vocab = get_vocab().for_category(category)
        allowed = [*vocab.conditionTags, *vocab.extraTags]
        payload = build_payload(category, situation_text(request.raw, category), request.conditions.tags, request.conditions.excluded, liked,
                                request.profile.tags, request.likedText, disliked, request.avoid, request.count, allowed)
        try:
            validation = validate_free(recommend_free(model, category, payload), request.count, [*request.avoid, *disliked, *liked], allowed,
                                       detail_required=category == "music")
            rows = persist_picks(session, category, validation.picks)
            results = [{"name": p.name, "detail": p.detail, "tasteReason": p.taste_reason, "contextReason": p.context_reason,
                        "confidence": p.confidence, "tags": p.tags, "item": public_item(r)} for r, p in zip(rows, validation.picks, strict=True)]
            # The model answered: "used" even if every pick was filtered out (issues says why).
            meta["ai"], meta["issues"] = "used", validation.summary()
        except Exception as exc:  # Timeouts, 5xx, quota, bad JSON: the lab shows the failure instead of hiding it.
            log.warning("free recommendation failed: %s", exc)
            meta["issues"] = type(exc).__name__
    meta["latencyMs"] = round((time.perf_counter() - started) * 1000)
    log.info("lab free %s: ai=%s results=%d issues=%s %dms", category, meta["ai"], len(results), meta["issues"], meta["latencyMs"])
    return {"results": results, "meta": meta}

"""Lab endpoints for comparing recommendation styles (plans-music-ai.md). Not used by the main flow."""
import logging
import time
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_session
from ..llm.client import JsonModel
from ..llm.free import build_payload, recommend_free, validate_free
from ..llm.provider import model_named
from ..models import Item
from ..schemas import Conditions, Profile
from ..vocab import get_vocab

log = logging.getLogger(__name__)
router = APIRouter()

Label = Annotated[str, StringConstraints(min_length=1, max_length=120)]


class FreeRequest(BaseModel):
    raw: Annotated[str, StringConstraints(max_length=300)] = ""
    conditions: Conditions = Conditions()
    profile: Profile = Profile()
    likedText: Annotated[list[Annotated[str, StringConstraints(min_length=1, max_length=60)]], Field(max_length=10)] = []
    avoid: Annotated[list[Label], Field(max_length=60)] = []  # 'title - artist' already shown in this request
    count: Annotated[int, Field(ge=1, le=5)] = 5
    model: Annotated[str, StringConstraints(max_length=60)] | None = None  # one of LAB_FREE_MODELS; None = the first

    @model_validator(mode="after")
    def known_vocabulary(self) -> "FreeRequest":
        vocab = get_vocab().music
        unknown = (set(self.conditions.tags) | set(self.profile.tags)) - vocab.tags
        unknown |= set(self.conditions.excluded) - set(vocab.exclusions)
        if unknown:
            raise ValueError(f"알 수 없는 조건: {sorted(unknown)}")
        return self


def get_free_models() -> dict[str, JsonModel]:
    """Allowed lab models by name. model_named shares each object with rerank and parsing, so a 429 seen
    anywhere pauses every caller of that model."""
    settings = get_settings()
    if not settings.rerank_enabled:
        return {}
    return {name: model for name in settings.lab_free_models if (model := model_named(name)) is not None}


@router.get("/api/lab/music/models")
def free_models(models: dict[str, JsonModel] = Depends(get_free_models)):
    return {"models": list(models)}


def song_labels(session: Session, ids: list[str]) -> list[str]:
    if not ids:
        return []
    rows = session.scalars(select(Item).where(Item.id.in_(ids), Item.category == "music")).all()
    order = {i: n for n, i in enumerate(ids)}
    return [f"{r.name} - {r.artist}" for r in sorted(rows, key=lambda r: order[r.id])]


@router.post("/api/lab/music/free")
def free_route(request: FreeRequest, session: Session = Depends(get_session), models: dict[str, JsonModel] = Depends(get_free_models)):
    started = time.perf_counter()
    if request.model is not None and models and request.model not in models:
        raise HTTPException(422, f"사용할 수 없는 모델: {request.model}")
    model = models.get(request.model) if request.model else next(iter(models.values()), None)
    liked, disliked = song_labels(session, request.profile.selected), song_labels(session, request.profile.disliked)
    meta = {"mode": "free", "requestId": str(uuid.uuid4()), "model": model.model if model else None, "ai": "off", "issues": None}
    results: list[dict] = []
    if model is not None:
        meta["ai"] = "failed"
        payload = build_payload(request.raw, request.conditions.tags, request.conditions.excluded, liked, request.profile.tags,
                                request.likedText, disliked, request.avoid, request.count)
        try:
            validation = validate_free(recommend_free(model, payload), request.count, [*request.avoid, *disliked, *liked])
            results = [{"title": p.title, "artist": p.artist, "tasteReason": p.taste_reason, "contextReason": p.context_reason,
                        "confidence": p.confidence} for p in validation.picks]
            meta["issues"] = validation.summary()
            if results:
                meta["ai"] = "used"
        except Exception as exc:  # Timeouts, 5xx, quota, bad JSON: the lab shows the failure instead of hiding it.
            log.warning("free recommendation failed: %s", exc)
            meta["issues"] = type(exc).__name__
    meta["latencyMs"] = round((time.perf_counter() - started) * 1000)
    log.info("lab free: ai=%s results=%d issues=%s %dms", meta["ai"], len(results), meta["issues"], meta["latencyMs"])
    return {"results": results, "meta": meta}

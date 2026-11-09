"""The AI engine for POST /api/recommend (2026-11-02): the model names items from its own knowledge.

Chosen for music after the lab comparison (plans-music-ai.md §6): the catalog pool repeated the same songs, the free
picks were varied and situational. The trade is that nothing guarantees a pick exists or honours an exclusion, so the
answer carries the model's confidence, the UI says the picks are the AI's own, and a failed call falls back to the
catalog pipeline (recommend.recommend) instead of returning nothing.
"""
import logging
import time
import uuid
from collections.abc import Callable, Collection, Mapping
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from .ai_items import is_ai_pick, item_label, labels_for, persist_picks
from .catalog import catalog_version, public_item, reviewed_items
from .config import get_settings
from .llm.client import JsonModel
from .llm.free import FreePick, FreeValidation, build_payload, recommend_free, validate_free
from .models import Item, RecommendationLog
from .parsing.rules import situation_text
from .recommend import PipelineConfig, recommend
from .retrieval.reasons import NO_TASTE_REASON
from .schemas import RecommendRequest
from .vocab import get_vocab

log = logging.getLogger(__name__)


def engine_for(request: RecommendRequest) -> str:
    """Favourites scope always ranks the saved items (catalog); otherwise the request's choice or the server default."""
    if request.candidateIds is not None:
        return "catalog"
    settings = get_settings()
    return request.engine or (settings.music_engine if request.category == "music" else settings.food_engine)


@dataclass
class AiAnswer:
    rows: list[Item]
    picks: dict[str, FreePick]  # by item id; pinned rows have none
    validation: FreeValidation | None
    error: str | None = None


def ask_picks(request: RecommendRequest, model: JsonModel, liked: list[str], disliked: list[str], avoid: list[str], wanted: int,
              dishes: Mapping[str, Collection[str]] | None) -> FreeValidation:
    """The model's answer after the server's checks, with no database: what production sends is what the evaluation measures."""
    category, conditions, profile = request.category, request.conditions, request.profile
    vocab = get_vocab().for_category(category)
    # Checks drop picks after the model answers, so it is asked for a few spare ones; only `wanted` go out.
    filtered = bool(conditions.excluded or request.years)
    asked = wanted + (3 if filtered else 2)
    food = category == "food"
    years = (request.years.start, request.years.end) if request.years and not food else None
    payload = build_payload(category, situation_text(request.raw, category), conditions.tags, conditions.excluded, liked, profile.tags,
                            profile.notes, disliked, [*avoid[-60:], *profile.customNames], asked, [*vocab.conditionTags, *vocab.extraTags],
                            base_dishes=list(dishes) if dishes else None, ingredient_words=vocab.excludableIngredients if food else None,
                            release_years={"from": years[0], "to": years[1]} if years else None)
    return validate_free(recommend_free(model, category, payload), wanted, [*avoid, *disliked, *liked, *profile.customNames], [*vocab.conditionTags, *vocab.extraTags],
                         detail_required=not food, excluded_values=vocab.blocked(conditions.excluded) if conditions.excluded else None, years=years, dishes=dishes)


def ask_model(session: Session, request: RecommendRequest, model: JsonModel) -> AiAnswer:
    category, profile = request.category, request.profile
    pinned_rows = session.scalars(select(Item).where(Item.id.in_(request.pinnedIds), Item.category == category)).all() if request.pinnedIds else []
    pinned_rows.sort(key=lambda r: request.pinnedIds.index(r.id))
    wanted = request.result_count - len(pinned_rows)
    if wanted <= 0:
        return AiAnswer(pinned_rows, {}, None)
    liked, disliked = labels_for(session, profile.selected, category), labels_for(session, profile.disliked, category)
    # Everything shown in this request, excluded from it, or pinned must not come back as a "new" pick.
    avoid = list(dict.fromkeys([*labels_for(session, [*request.seenIds, *request.excludedIds], category), *(item_label(r) for r in pinned_rows)]))
    dishes = {r.name: {*r.tags, *r.ingredients} for r in reviewed_items(session) if r.category == "food"} if category == "food" else None
    validation = ask_picks(request, model, liked, disliked, avoid, wanted, dishes)
    rows = persist_picks(session, category, validation.picks)
    # A pick that resolved to an item the client already saw or excluded (same song, different spelling) is dropped too.
    blocked = {*request.seenIds, *request.excludedIds, *profile.disliked, *(r.id for r in pinned_rows)}
    kept = [(r, p) for r, p in zip(rows, validation.picks, strict=True) if r.id not in blocked]
    if len(kept) < len(rows):
        validation.issues["blocked_id"] += len(rows) - len(kept)
    seen_ids: set[str] = set()
    unique = [(r, p) for r, p in kept if not (r.id in seen_ids or seen_ids.add(r.id))]
    return AiAnswer([*pinned_rows, *(r for r, _ in unique)], {r.id: p for r, p in unique}, validation)


def recommend_ai(session: Session, request: RecommendRequest, model: JsonModel | None, config: PipelineConfig = PipelineConfig(),
                 fallback: Callable[..., dict] = recommend, **fallback_kwargs) -> dict:
    """AI picks, or the catalog pipeline's answer (with ai 'failed'/'off' and engine 'catalog') when the model is
    missing, errors out, or returns nothing usable."""
    started = time.perf_counter()
    if model is None:
        answer = fallback(session, request, config=config, **fallback_kwargs)
        answer["meta"].update({"engine": "catalog", "engineWanted": "ai", "ai": "off"})
        return answer
    try:
        result = ask_model(session, request, model)
    except Exception as exc:  # Timeouts, 5xx, quota, bad JSON: the user still gets the catalog's answer.
        log.warning("ai engine failed: %s", exc)
        answer = fallback(session, request, config=config, **fallback_kwargs)
        answer["meta"].update({"engine": "catalog", "engineWanted": "ai", "ai": "failed", "aiError": type(exc).__name__})
        return answer
    if not result.rows:
        answer = fallback(session, request, config=config, **fallback_kwargs)
        answer["meta"].update({"engine": "catalog", "engineWanted": "ai", "ai": "failed", "aiError": result.validation.summary() if result.validation else "empty"})
        return answer

    has_taste = bool(request.profile.selected or request.profile.tags or request.profile.notes)
    results = []
    for row in result.rows:
        pick = result.picks.get(row.id)
        if pick is None:  # pinned: kept as the client showed it, with neutral reasons
            taste, context, confidence = ("내 취향에 등록한 곡이에요" if row.id in request.profile.selected else "이번 요청에 고정한 곡이에요"), "고정한 곡이라 그대로 두었어요", None
        else:
            taste, context, confidence = pick.taste_reason, pick.context_reason, pick.confidence
        if not has_taste:
            taste = NO_TASTE_REASON
        item = public_item(row)
        results.append({"item": item, "tasteReason": taste, "contextReason": context,
                        **({"confidence": confidence} if confidence else {}), **({"aiPick": True} if is_ai_pick(row.id) or pick else {}),
                        **({"broad": True} if pick and pick.broad else {})})

    request_id = uuid.uuid4()
    latency_ms = round((time.perf_counter() - started) * 1000)
    issues = result.validation.summary() if result.validation else None
    if config.write_log:
        _write_log(session, RecommendationLog(
            id=request_id, category=request.category, raw_text=request.raw if config.log_raw_text else None,
            conditions=request.conditions.model_dump(),
            params={"engine": "ai", "model": model.model, "count": request.result_count, "pinned": len(request.pinnedIds), "issues": issues},
            candidate_ids=[], candidate_scores={}, result_ids=[r["item"]["id"] for r in results], mode="rag", latency_ms=latency_ms, error=None,
        ))
    log.info("ai engine: %s results=%d issues=%s %dms", request.category, len(results), issues, latency_ms)
    return {
        "results": results,
        "meta": {
            "mode": "rag", "engine": "ai", "model": model.model,
            "eligibleCount": len(results),
            "newCount": sum(r["item"]["id"] not in set(request.seenIds) for r in results),
            "catalogVersion": catalog_version(public_item(r) for r in reviewed_items(session)),
            "requestId": str(request_id),
            "contextSimilarity": True,  # the model read the sentence itself
            "ai": "used",
            "situational": bool(request.raw.strip() or request.conditions.tags),
            "issues": issues,
        },
    }


def _write_log(session: Session, entry: RecommendationLog) -> None:
    try:
        session.add(entry)
        session.commit()
    except Exception as exc:
        session.rollback()
        log.warning("recommendation log failed: %s", exc)

"""Recommendation pipeline: SQL filter → scores → τ + MMR selection → AI rerank → validation → log
(plans-rag.md §2, §6).

`rag` mode: the model picked and explained at least one card. `retrieval_only`: no model, a model error,
or no valid pick — the top retrieval candidates with template reasons.
"""
import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from .catalog import catalog_version, public_item, reviewed_items
from .embeddings import query_text
from .llm.client import JsonModel
from .llm.rerank import RerankCandidate, build_payload, rerank
from .llm.validate import Pick, validate_picks
from .models import Item, RecommendationLog
from .parsing.rules import situation_text
from .retrieval.filters import eligible_query
from .retrieval.reasons import NO_TASTE_REASON, context_reason, taste_reason
from .retrieval.scoring import Candidate, Weights, mean_vector, score_candidates
from .retrieval.select import SelectionParams, cap_familiar, select_candidates
from .schemas import RecommendRequest

log = logging.getLogger(__name__)

# Candidates handed to the AI rerank (plans-rag.md §6.5); retrieval_only shows the first `count`.
POOL_SIZE = {"food": 10, "music": 15}


@dataclass(frozen=True)
class PipelineConfig:
    weights: Weights = Weights()
    selection: SelectionParams = SelectionParams()
    log_raw_text: bool = True
    write_log: bool = True  # offline evaluation runs (app.cli.eval) keep the request log clean


def as_vector(value) -> np.ndarray | None:
    return None if value is None else np.asarray(value, dtype=np.float64)


def recommend(session: Session, request: RecommendRequest, embed_query: Callable[[str], list[float]] | None,
              config: PipelineConfig = PipelineConfig(), rng: np.random.Generator | None = None,
              rerank_model: JsonModel | None = None) -> dict:
    started = time.perf_counter()
    conditions, profile = request.conditions, request.profile
    rows = session.scalars(eligible_query(request.category, conditions.excluded, profile.disliked,
                                          request.excludedIds, request.candidateIds)).all()
    liked_rows = session.scalars(select(Item).where(Item.id.in_(profile.selected), Item.category == request.category)).all() if profile.selected else []

    errors: list[str] = []
    context_vector = None
    # Price, delivery and nearby phrases are unsupported; they must not steer the embedding or the model.
    situation = situation_text(request.raw, request.category)
    if embed_query and (text := query_text(situation, conditions.tags)):
        try:
            context_vector = as_vector(embed_query(text))
        except Exception as exc:  # The pipeline still ranks by taste and tags without the sentence.
            log.warning("query embedding failed: %s", exc)
            errors.append(f"query_embedding:{type(exc).__name__}")
    taste_vector = mean_vector([v for r in liked_rows if (v := as_vector(r.embedding)) is not None])

    candidates = [Candidate(r.id, list(r.tags), as_vector(r.embedding)) for r in rows]
    scored = score_candidates(candidates, context_vector, taste_vector, conditions.tags, profile.tags, config.weights)
    selection = SelectionParams(**{**config.selection.__dict__, **({"tau": request.tau} if request.tau is not None else {})})
    pool = select_candidates(scored, {c.id: c.vector for c in candidates}, set(request.seenIds), request.pinnedIds,
                             POOL_SIZE[request.category], selection, rng)
    by_id = {r.id: r for r in rows}
    liked_ids, wanted = set(profile.selected), set(conditions.tags)
    pool, held_back = cap_familiar(pool, liked_ids, set(request.pinnedIds), lambda i: not wanted or bool(wanted & set(by_id[i].tags)),
                                   set(request.seenIds))
    preferred = set(profile.tags).union(*(r.tags for r in liked_rows))
    has_taste = bool(profile.selected or profile.tags)

    templates = {i: (taste_reason(i, list(by_id[i].tags), preferred, liked_ids, has_taste, request.category),
                     context_reason(list(by_id[i].tags), conditions.tags, conditions.excluded)) for i in pool}
    scores = {s.id: s for s in scored}

    # Same guarantee as retrieval (plans.md U2): while enough unseen candidates remain, the model only sees
    # those; otherwise every remaining unseen card is required and the rest comes from seen ones.
    seen, pinned = set(request.seenIds), set(request.pinnedIds)
    pinned_ids = [i for i in pool if i in pinned]
    unseen = [i for i in pool if i not in seen and i not in pinned]
    enough = len(unseen) >= request.result_count - len(pinned_ids)
    allowed = [*pinned_ids, *unseen] if enough else pool
    required = [] if enough else unseen
    # Liked items held back by cap_familiar stay out of the model's choice while enough others remain.
    if len(trimmed := [i for i in allowed if i not in held_back or i in required]) >= request.result_count:
        allowed = trimmed

    mode, ai_status = "retrieval_only", "off"  # ai: off (no model) | failed (tried, unusable) | used
    picks = [Pick(i, *templates[i], by_ai=False) for i in pool[: request.result_count]]
    if rerank_model and allowed:
        ai_status = "failed"
        try:
            payload = build_payload(
                request.category, situation, conditions.tags, conditions.excluded,
                [r.name if not r.artist else f"{r.name} - {r.artist}" for r in liked_rows], profile.tags,
                [RerankCandidate(i, by_id[i].name, by_id[i].artist, by_id[i].description, list(by_id[i].tags),
                                 list(by_id[i].ingredients), scores[i].score) for i in allowed],
                pinned_ids, request.result_count)
            liked_names = {r.name for r in liked_rows} | {r.artist for r in liked_rows if r.artist}
            shown_names = {by_id[i].name for i in allowed} | {by_id[i].artist for i in allowed if by_id[i].artist}
            validation = validate_picks(rerank(rerank_model, payload), allowed, pinned_ids, required, request.result_count,
                                        templates, unliked_names=shown_names - liked_names)
            if validation.ai_count:
                mode, picks, ai_status = "rag", validation.picks, "used"
                if issues := validation.summary():
                    errors.append(f"rerank:{issues}")
            else:
                errors.append("rerank:no_valid_picks")
        except Exception as exc:  # Timeouts, 5xx, quota, bad JSON: the user still gets the retrieval result.
            log.warning("rerank failed: %s", exc)
            errors.append(f"rerank:{type(exc).__name__}")
    result_ids = [p.id for p in picks]
    # No registered taste means no taste claim, whoever wrote the reason.
    if not has_taste:
        picks = [replace(p, taste_reason=NO_TASTE_REASON) for p in picks]
    results = [{"item": public_item(by_id[p.id]), "tasteReason": p.taste_reason, "contextReason": p.context_reason} for p in picks]

    request_id = uuid.uuid4()
    latency_ms = round((time.perf_counter() - started) * 1000)
    if config.write_log:
        _write_log(session, RecommendationLog(
            id=request_id, category=request.category, raw_text=request.raw if config.log_raw_text else None,
            conditions=conditions.model_dump(),
            params={"weights": config.weights.__dict__, "selection": selection.__dict__, "contextVector": context_vector is not None,
                    "tasteVector": taste_vector is not None, "rerankModel": rerank_model.model if rerank_model else None,
                    "aiPicks": sum(p.by_ai for p in picks)},
            candidate_ids=pool, candidate_scores={i: {"score": round(scores[i].score, 4), **scores[i].parts} for i in pool},
            result_ids=result_ids, mode=mode, latency_ms=latency_ms, error=";".join(errors) or None,
        ))
    return {
        "results": results,
        "meta": {
            "mode": mode,
            "eligibleCount": len(rows),
            "newCount": sum(i not in set(request.seenIds) for i in result_ids),
            "catalogVersion": catalog_version(public_item(r) for r in reviewed_items(session)),
            "requestId": str(request_id),
            "contextSimilarity": context_vector is not None,
            # Lets the UI say when the answer came without the AI or without the sentence's meaning.
            "ai": ai_status,
            "situational": bool(query_text(situation, conditions.tags)),
        },
    }


def _write_log(session: Session, entry: RecommendationLog) -> None:
    # Logging is for evaluation; a failed insert must not cost the user their recommendation.
    try:
        session.add(entry)
        session.commit()
    except Exception as exc:
        session.rollback()
        log.warning("recommendation log failed: %s", exc)

"""Recommendation pipeline: SQL filter → scores → τ + MMR selection → reasons → log (plans-rag.md §2, §6).

R2 serves `retrieval_only`: the top candidates with template reasons. R4 adds the AI rerank on top of the
same candidate pool.
"""
import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from .catalog import catalog_version, public_item, reviewed_items
from .embeddings import query_text
from .models import Item, RecommendationLog
from .retrieval.filters import eligible_query
from .retrieval.reasons import context_reason, taste_reason
from .retrieval.scoring import Candidate, Weights, mean_vector, score_candidates
from .retrieval.select import SelectionParams, select_candidates
from .schemas import RecommendRequest

log = logging.getLogger(__name__)

# Candidates handed to the AI rerank from R4 (plans-rag.md §6.5); retrieval_only shows the first `count`.
POOL_SIZE = {"food": 10, "music": 15}


@dataclass(frozen=True)
class PipelineConfig:
    weights: Weights = Weights()
    selection: SelectionParams = SelectionParams()
    log_raw_text: bool = True


def as_vector(value) -> np.ndarray | None:
    return None if value is None else np.asarray(value, dtype=np.float64)


def recommend(session: Session, request: RecommendRequest, embed_query: Callable[[str], list[float]] | None,
              config: PipelineConfig = PipelineConfig(), rng: np.random.Generator | None = None) -> dict:
    started = time.perf_counter()
    conditions, profile = request.conditions, request.profile
    rows = session.scalars(eligible_query(request.category, conditions.excluded, conditions.maxPrice, profile.disliked,
                                          request.excludedIds, request.candidateIds)).all()
    liked_rows = session.scalars(select(Item).where(Item.id.in_(profile.selected), Item.category == request.category)).all() if profile.selected else []

    errors: list[str] = []
    context_vector = None
    if embed_query and (text := query_text(request.raw, conditions.tags)):
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
    result_ids = pool[: request.result_count]

    by_id = {r.id: r for r in rows}
    preferred = set(profile.tags).union(*(r.tags for r in liked_rows))
    results = [{"item": public_item(by_id[i]), "tasteReason": taste_reason(by_id[i].tags, preferred),
                "contextReason": context_reason(by_id[i].tags, conditions.tags)} for i in result_ids]

    request_id = uuid.uuid4()
    scores = {s.id: s for s in scored}
    latency_ms = round((time.perf_counter() - started) * 1000)
    _write_log(session, RecommendationLog(
        id=request_id, category=request.category, raw_text=request.raw if config.log_raw_text else None,
        conditions=conditions.model_dump(),
        params={"weights": config.weights.__dict__, "selection": selection.__dict__, "contextVector": context_vector is not None,
                "tasteVector": taste_vector is not None},
        candidate_ids=pool, candidate_scores={i: {"score": round(scores[i].score, 4), **scores[i].parts} for i in pool},
        result_ids=result_ids, mode="retrieval_only", latency_ms=latency_ms, error=";".join(errors) or None,
    ))
    return {
        "results": results,
        "meta": {
            "mode": "retrieval_only",
            "eligibleCount": len(rows),
            "newCount": sum(i not in set(request.seenIds) for i in result_ids),
            "catalogVersion": catalog_version(public_item(r) for r in reviewed_items(session)),
            "requestId": str(request_id),
            "contextSimilarity": context_vector is not None,
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

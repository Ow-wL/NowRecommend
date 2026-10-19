"""Candidate scores: situation similarity + taste similarity + condition tag match (plans-rag.md §6.4).

Cosine values from one embedding model sit in a narrow band (≈0.6–0.85), so each cosine component is
min-max normalised over the eligible candidates before weighting; otherwise the 0–1 tag match would dominate.
Weights of missing components (no sentence, no taste) are redistributed over the remaining ones.
"""
from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True)
class Weights:
    context: float = 0.45
    taste: float = 0.35
    tag: float = 0.20


@dataclass
class Candidate:
    id: str
    tags: list[str]
    vector: np.ndarray | None


@dataclass
class Scored:
    id: str
    score: float
    parts: dict[str, float] = field(default_factory=dict)


def minmax(values: np.ndarray) -> np.ndarray:
    span = values.max() - values.min() if len(values) else 0
    return (values - values.min()) / span if span > 1e-9 else np.zeros_like(values)


def cosine_component(candidates: Sequence[Candidate], query: np.ndarray | None) -> np.ndarray | None:
    if query is None:
        return None
    raw = np.array([float(c.vector @ query) if c.vector is not None else np.nan for c in candidates])
    present = ~np.isnan(raw)
    result = np.zeros(len(candidates))
    if present.any():
        result[present] = minmax(raw[present])
    return result


def overlap(tags: list[str], wanted: set[str]) -> float:
    return len(wanted.intersection(tags)) / len(wanted) if wanted else 0.0


def score_candidates(candidates: Sequence[Candidate], context_vector: np.ndarray | None, taste_vector: np.ndarray | None,
                     condition_tags: Sequence[str], profile_tags: Sequence[str], weights: Weights = Weights()) -> list[Scored]:
    if not candidates:
        return []
    wanted, liked = set(condition_tags), set(profile_tags)
    context = cosine_component(candidates, context_vector)
    taste_cos = cosine_component(candidates, taste_vector)
    taste_tags = np.array([overlap(c.tags, liked) for c in candidates]) if liked else None
    taste_parts = [p for p in (taste_cos, taste_tags) if p is not None]
    taste = np.mean(taste_parts, axis=0) if taste_parts else None
    tag = np.array([overlap(c.tags, wanted) for c in candidates]) if wanted else None

    components = {"context": (context, weights.context), "taste": (taste, weights.taste), "tag": (tag, weights.tag)}
    active = {name: (values, w) for name, (values, w) in components.items() if values is not None}
    total_weight = sum(w for _, w in active.values())
    scored = []
    for index, candidate in enumerate(candidates):
        parts = {name: round(float(values[index]), 4) for name, (values, _) in active.items()}
        score = sum(w * values[index] for values, w in active.values()) / total_weight if total_weight else 0.0
        scored.append(Scored(candidate.id, float(score), parts))
    return scored


def mean_vector(vectors: Sequence[np.ndarray]) -> np.ndarray | None:
    if not vectors:
        return None
    mean = np.mean(np.stack(vectors), axis=0)
    norm = np.linalg.norm(mean)
    return mean / norm if norm > 1e-9 else None

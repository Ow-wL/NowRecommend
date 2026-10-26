"""Candidate selection: exploration temperature τ, then MMR for variety (plans-rag.md §6.5).

Order is tiered like recommend() in src/domain.ts — pinned, then not yet seen in this request, then seen —
so a re-roll never repeats a candidate while unseen ones remain (plans.md U2). MMR runs inside each tier.
"""
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np

from .scoring import Scored


@dataclass(frozen=True)
class SelectionParams:
    tau: float = 0.05        # 0 → identical results for identical requests (evaluation, tests)
    mmr_lambda: float = 0.7  # 1 → pure relevance, lower → more variety
    pool_size: int = 40      # top candidates per tier considered by MMR


def explore(scored: Sequence[Scored], tau: float, rng: np.random.Generator) -> dict[str, float]:
    """score + τ·Gumbel noise: sampling proportional to exp(score/τ) without replacement."""
    if tau <= 0:
        return {s.id: s.score for s in scored}
    noise = rng.gumbel(size=len(scored))
    return {s.id: s.score + tau * float(n) for s, n in zip(scored, noise)}


def pairwise_similarity(ids: Sequence[str], vectors: dict[str, np.ndarray | None]) -> dict[tuple[str, str], float]:
    """Item-item cosine, min-max normalised over the pool so the diversity term is on the same 0–1 scale as relevance."""
    present = [i for i in ids if vectors.get(i) is not None]
    if len(present) < 2:
        return {}
    matrix = np.stack([vectors[i] for i in present])
    sims = matrix @ matrix.T
    upper = sims[np.triu_indices(len(present), k=1)]
    low, span = float(upper.min()), float(upper.max() - upper.min())
    scale = (lambda v: (v - low) / span) if span > 1e-9 else (lambda v: 0.0)
    return {(a, b): scale(float(sims[x, y])) for x, a in enumerate(present) for y, b in enumerate(present) if x != y}


def mmr(pool: list[str], relevance: dict[str, float], chosen: list[str], sims: dict[tuple[str, str], float],
        limit: int, lam: float) -> list[str]:
    picked: list[str] = []
    remaining = list(pool)
    while remaining and len(picked) < limit:
        def value(candidate: str) -> tuple[float, str]:
            redundancy = max((sims.get((candidate, other), 0.0) for other in [*chosen, *picked]), default=0.0)
            # Negated id breaks ties deterministically toward the smaller id, matching the frontend's sort.
            return lam * relevance[candidate] - (1 - lam) * redundancy, _reverse(candidate)
        best = max(remaining, key=value)
        picked.append(best)
        remaining.remove(best)
    return picked


def _reverse(text: str) -> str:
    return "".join(chr(0x10FFFF - ord(c)) for c in text)


def select_candidates(scored: Sequence[Scored], vectors: dict[str, np.ndarray | None], seen: set[str], pinned: Sequence[str],
                      limit: int, params: SelectionParams = SelectionParams(), rng: np.random.Generator | None = None) -> list[str]:
    available = {s.id for s in scored}
    relevance = explore(scored, params.tau, rng or np.random.default_rng())
    chosen = [p for p in dict.fromkeys(pinned) if p in available][:limit]
    for tier in ([s for s in available if s not in chosen and s not in seen], [s for s in available if s not in chosen and s in seen]):
        if len(chosen) >= limit:
            break
        pool = sorted(tier, key=lambda i: (-relevance[i], i))[: params.pool_size]
        sims = pairwise_similarity([*chosen, *pool], vectors)
        chosen += mmr(pool, relevance, chosen, sims, limit - len(chosen), params.mmr_lambda)
    return chosen


# Same order as capFamiliar in src/domain.ts: pinned, then unseen, then seen (only when unseen ones run out). Inside a
# tier: candidates matching a wanted tag with at most one registered favourite per round (they filled 3 of 5 songs,
# 2026-10-27), then the other favourites, then candidates matching no wanted tag. Tags rank, they do not filter.
FAMILIAR_LIMIT = 1


def cap_familiar(ordered: Sequence[str], liked: set[str], pinned: set[str], relevant: Callable[[str], bool],
                 seen: set[str] = frozenset()) -> tuple[list[str], set[str]]:
    """→ (reordered ids, liked ids held back). Pinned ids always lead."""
    familiar = sum(1 for i in ordered if i in pinned and i in liked)
    held_back: set[str] = set()

    def arrange(tier: list[str]) -> list[str]:
        nonlocal familiar
        kept, deferred, off_topic = [], [], []
        for i in tier:
            if not relevant(i):
                off_topic.append(i)
            elif i not in liked:
                kept.append(i)
            elif familiar < FAMILIAR_LIMIT:
                familiar += 1
                kept.append(i)
            else:
                deferred.append(i)
        held_back.update(deferred)
        return [*kept, *deferred, *off_topic]

    rest = [i for i in ordered if i not in pinned]
    return [*(i for i in ordered if i in pinned), *arrange([i for i in rest if i not in seen]), *arrange([i for i in rest if i in seen])], held_back

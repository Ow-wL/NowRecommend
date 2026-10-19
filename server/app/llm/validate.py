"""Server-side check of the model's picks: only allowed ids, no duplicates, required cards kept,
exactly `count` results — anything missing is filled from the retrieval order with template reasons."""
from collections import Counter
from collections.abc import Collection, Sequence
from dataclasses import dataclass, field

from .rerank import REASON_LIMIT


@dataclass
class Pick:
    id: str
    taste_reason: str
    context_reason: str
    by_ai: bool


@dataclass
class Validation:
    picks: list[Pick]
    issues: Counter = field(default_factory=Counter)

    @property
    def ai_count(self) -> int:
        return sum(p.by_ai for p in self.picks)

    def summary(self) -> str | None:
        return ",".join(f"{k}={v}" for k, v in sorted(self.issues.items())) or None


def clean_reason(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    if not text:
        return None
    return text if len(text) <= REASON_LIMIT else text[: REASON_LIMIT - 1].rstrip() + "…"


def validate_picks(raw: Sequence, allowed: Sequence[str], pinned: Sequence[str], required: Sequence[str], count: int,
                   templates: dict[str, tuple[str, str]], unliked_names: Collection[str] = ()) -> Validation:
    """`allowed` is in retrieval order; `pinned` lead the result, `required` (unseen cards that must
    appear because there are too few) are kept even if the model drops them.

    `unliked_names` are item names and artists the user did not pick as tastes. A taste reason that
    names one of them claims a liking the user never stated (R4: "평소 좋아하는 BTS" for a classical
    listener), so it is replaced by the template reason."""
    issues: Counter = Counter()
    allowed_set = set(allowed)
    template = lambda i: Pick(i, *templates[i], by_ai=False)  # noqa: E731
    by_ai: dict[str, Pick] = {}
    for entry in raw:
        if not isinstance(entry, dict):
            issues["malformed"] += 1
            continue
        item_id = entry.get("id")
        if item_id not in allowed_set:
            issues["unknown_id"] += 1
            continue
        if item_id in by_ai:
            issues["duplicate"] += 1
            continue
        taste, context = clean_reason(entry.get("tasteReason")), clean_reason(entry.get("contextReason"))
        if taste is None or context is None:
            issues["empty_reason"] += 1
        if taste and any(name in taste for name in unliked_names):
            issues["taste_claim"] += 1
            taste = None
        fallback_taste, fallback_context = templates[item_id]
        by_ai[item_id] = Pick(item_id, taste or fallback_taste, context or fallback_context, by_ai=True)

    pinned_picks = [by_ai.get(i) or template(i) for i in pinned]
    rest = [p for i, p in by_ai.items() if i not in pinned]
    for i in required:
        if i not in by_ai and i not in pinned:
            issues["missing_required"] += 1
            rest.insert(0, template(i))
    issues["missing_pinned"] += sum(i not in by_ai for i in pinned)

    result = pinned_picks + rest
    keep = set(pinned) | set(required)
    while len(result) > count:
        drop = next(index for index in range(len(result) - 1, -1, -1) if result[index].id not in keep)
        result.pop(drop)
        issues["extra"] += 1
    chosen = {p.id for p in result}
    for i in allowed:
        if len(result) >= count:
            break
        if i not in chosen:
            result.append(template(i))
            issues["filled"] += 1
    return Validation(result, +issues)

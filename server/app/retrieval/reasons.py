"""Template reasons, identical in wording to recommend() in src/domain.ts.

Used for every result in retrieval_only mode and, from R4, for anything the AI fails to explain.
"""
from collections.abc import Iterable


def taste_reason(item_tags: list[str], preferred: set[str]) -> str:
    taste = [t for t in item_tags if t in preferred][:2]
    return f"좋아하는 {' · '.join(taste)}에 가까워요" if taste else "새로운 취향을 발견해보세요"


def context_reason(item_tags: list[str], condition_tags: Iterable[str]) -> str:
    wanted = set(condition_tags)
    context = [t for t in item_tags if t in wanted][:2]
    return f"이번에 고른 {' · '.join(context)}에 어울려요" if context else "제외 조건을 지키는 새로운 선택이에요"

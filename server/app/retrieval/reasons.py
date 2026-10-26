"""Template reasons, identical in wording to templateReasons() in src/domain.ts.

Used for every result in retrieval_only mode and for anything the AI fails to explain. They say what is true of the
card alone and never claim a taste that was not registered. How a card differs from the others shown with it depends
on the final set (a one-card replacement changes it), so the browser computes that (contrastReason, withContrast).
"""
from collections.abc import Iterable, Sequence

NO_TASTE_REASON = "등록된 취향이 없어 취향은 반영하지 않았어요"


def taste_reason(item_id: str, item_tags: list[str], preferred: set[str], liked_ids: Iterable[str], has_taste: bool, category: str) -> str:
    if not has_taste:
        return NO_TASTE_REASON
    if item_id in set(liked_ids):
        return f"내 취향에 등록한 {'메뉴예요' if category == 'food' else '곡이에요'}"
    taste = [t for t in item_tags if t in preferred][:2]
    return f"좋아하는 {' · '.join(taste)}에 가까워요" if taste else "평소 취향과 다른 새로운 선택이에요"


def context_reason(item_tags: list[str], condition_tags: Sequence[str], excluded: Sequence[str]) -> str:
    wanted = set(condition_tags)
    matched = [t for t in item_tags if t in wanted][:2]
    return (f"이번 조건 {' · '.join(matched)}에 맞아요." if matched else "고른 조건과 겹치는 특징은 적어요." if condition_tags
            else "등록 정보 기준으로 제외 조건을 적용했어요." if excluded else "상황 조건 없이 골랐어요.")

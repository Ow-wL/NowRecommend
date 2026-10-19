"""Hard filters in SQL. Must mean exactly what eligibleCandidates in src/domain.ts means (shared/filter-cases.json)."""
from sqlalchemy import Select, Text, cast, select
from sqlalchemy.dialects.postgresql import ARRAY

from ..models import Item


def eligible_query(category: str, excluded: list[str], max_price: int | None, disliked: list[str],
                   excluded_ids: list[str], candidate_ids: list[str] | None) -> Select[tuple[Item]]:
    query = select(Item).where(Item.category == category, Item.status == "reviewed")
    if blocked := [*disliked, *excluded_ids]:
        query = query.where(Item.id.not_in(blocked))
    if candidate_ids is not None:
        query = query.where(Item.id.in_(candidate_ids))
    if excluded:
        values = cast(excluded, ARRAY(Text))  # bound as text[]; varchar[] has no && with text[]
        # An excluded value may be a taste tag (매콤함, 보컬) or an ingredient (밀, 땅콩); both block the item.
        query = query.where(~Item.tags.op("&&")(values), ~Item.ingredients.op("&&")(values))
    if max_price is not None:
        # Items without a reference price never pass a budget, as in the frontend.
        query = query.where(Item.cost.is_not(None), Item.cost <= max_price)
    return query.order_by(Item.id)


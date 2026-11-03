"""Hard filters in SQL. Must mean exactly what eligibleCandidates in src/domain.ts means (shared/filter-cases.json)."""
from sqlalchemy import Select, Text, cast, select
from sqlalchemy.dialects.postgresql import ARRAY

from ..models import Item
from ..vocab import get_vocab


def eligible_query(category: str, excluded: list[str], disliked: list[str],
                   excluded_ids: list[str], candidate_ids: list[str] | None,
                   year_from: int | None = None, year_to: int | None = None) -> Select[tuple[Item]]:
    query = select(Item).where(Item.category == category, Item.status == "reviewed")
    if blocked := [*disliked, *excluded_ids]:
        query = query.where(Item.id.not_in(blocked))
    if candidate_ids is not None:
        query = query.where(Item.id.in_(candidate_ids))
    if excluded:
        # A group ("해산물") blocks the ingredients it covers; bound as text[] (varchar[] has no && with text[]).
        values = cast(get_vocab().for_category(category).blocked(excluded), ARRAY(Text))
        # An excluded value may be a taste tag (매콤함, 보컬) or an ingredient (밀, 땅콩); both block the item.
        query = query.where(~Item.tags.op("&&")(values), ~Item.ingredients.op("&&")(values))
    # A song with no known year cannot be said to fall in the range.
    if year_from is not None:
        query = query.where(Item.release_year >= year_from)
    if year_to is not None:
        query = query.where(Item.release_year <= year_to)
    return query.order_by(Item.id)


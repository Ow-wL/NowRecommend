"""Facts a dish's name makes plain, read from server/data/dish_facts.json. No model is involved."""
import json
from functools import lru_cache
from pathlib import Path

FACTS_FILE = Path(__file__).resolve().parents[1] / "data" / "dish_facts.json"


@lru_cache
def dish_table() -> dict:
    return json.loads(FACTS_FILE.read_text(encoding="utf-8"))["attributes"]


def table_hits(table: dict, text: str) -> set[str]:
    hits = set()
    for attribute, rule in table.items():
        rest = text
        for word in rule["except"]:
            rest = rest.replace(word, "")
        if any(word in rest for word in rule["words"]):
            hits.add(attribute)
    return hits


def name_attributes(text: str) -> set[str]:
    return table_hits(dish_table(), text)

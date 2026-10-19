import json

import pytest
from pydantic import ValidationError

from app.config import get_settings
from app.vocab import load_vocab


def test_shared_vocab_loads():
    vocab = load_vocab(get_settings().vocab_path)
    assert {"담백함", "한식"} <= vocab.food.tags
    assert "밀" in vocab.food.exclusions and "밀" in vocab.food.excludableIngredients
    assert vocab.music.excludableIngredients == []


def write(tmp_path, food_overrides):
    data = json.loads(get_settings().vocab_path.read_text(encoding="utf-8"))
    data["food"].update(food_overrides)
    path = tmp_path / "vocab.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


@pytest.mark.parametrize(
    "overrides",
    [
        {"conditionTags": ["혼자", "혼자"]},
        {"exclusions": ["매콤함", "없는태그"]},
        {"excludableIngredients": ["소고기", "새우"]},
    ],
)
def test_inconsistent_vocab_is_rejected(tmp_path, overrides):
    with pytest.raises(ValidationError):
        load_vocab(write(tmp_path, overrides))

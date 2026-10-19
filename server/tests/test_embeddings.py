import math
from types import SimpleNamespace

import pytest

from app.catalog import SEED_FILE, load_seed, validate_item
from app.embeddings import GeminiEmbedder, document_text, embedding_hash
from app.vocab import get_vocab


def item(**overrides):
    base = dict(category="food", name="쌀국수", artist=None, description="따뜻한 국물.", tags=["담백함", "국물"],
                ingredients=["소고기", "밀"], price_label="9,000–12,000원")
    return SimpleNamespace(**{**base, **overrides})


def test_food_document_text_carries_features_for_similarity():
    text = document_text(item())
    assert text.startswith("title: 쌀국수 | text: 음식.")
    assert "담백함, 국물" in text and "소고기, 밀" in text and "9,000–12,000원" in text


def test_music_document_text_names_artist():
    text = document_text(item(category="music", name="밤편지", artist="아이유", tags=["차분함"], ingredients=[], price_label=None))
    assert text == "title: 밤편지 - 아이유 | text: 음악. 따뜻한 국물. 분위기·장르: 차분함."


def test_hash_tracks_text_model_and_dimension():
    base = embedding_hash("m", 768, "a")
    assert base == embedding_hash("m", 768, "a")
    assert len({base, embedding_hash("m2", 768, "a"), embedding_hash("m", 1536, "a"), embedding_hash("m", 768, "b")}) == 4


class FakeClient:
    def __init__(self, drop=0, fail_times=0):
        self.batches, self.drop, self.fail_times = [], drop, fail_times
        self.models = self

    def embed_content(self, model, contents, config):
        if self.fail_times:
            self.fail_times -= 1
            raise ConnectionError("temporary")
        self.batches.append([c.parts[0].text for c in contents])
        assert config.output_dimensionality == 768
        values = [SimpleNamespace(values=[3.0, 4.0] + [0.0] * 766) for _ in contents[self.drop:]]
        return SimpleNamespace(embeddings=values)


def test_gemini_embedder_batches_retries_and_normalizes(monkeypatch):
    monkeypatch.setattr("app.embeddings.time.sleep", lambda _: None)
    client = FakeClient(fail_times=1)
    vectors = GeminiEmbedder("k", "gemini-embedding-2", batch_size=2, client=client).embed(["a", "b", "c"])
    assert client.batches == [["a", "b"], ["c"]]
    assert len(vectors) == 3 and math.isclose(vectors[0][0], 0.6) and math.isclose(sum(v * v for v in vectors[0]), 1)


def test_gemini_embedder_rejects_merged_embeddings():
    with pytest.raises(RuntimeError, match="expected 2 embeddings"):
        GeminiEmbedder("k", "m", client=FakeClient(drop=1)).embed(["a", "b"])


def test_gemini_embedder_rejects_wrong_dimension():
    with pytest.raises(ValueError):
        GeminiEmbedder("k", "m", dim=1536, client=FakeClient())


def test_seed_file_passes_validation():
    items = load_seed(SEED_FILE)
    assert len(items) == 31
    assert [e for i in items for e in validate_item(get_vocab(), i)] == []


@pytest.mark.parametrize("change, error", [({"tags": ["없는태그"]}, "태그"), ({"cost": None}, "기준 가격"), ({"category": "drink"}, "분야")])
def test_validation_rejects_bad_items(change, error):
    bad = {**load_seed(SEED_FILE)[0], **change}
    assert any(error in e for e in validate_item(get_vocab(), bad))

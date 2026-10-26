"""Item/query embedding text and the embedding client.

gemini-embedding-2 has no task_type field; the task goes into the text itself
(`title: … | text: …` for documents, `task: search result | query: …` for queries).
"""
import hashlib
import math
import time
from collections import OrderedDict
from collections.abc import Sequence
from typing import Protocol

from .llm.client import retry_delay
from .models import EMBEDDING_DIM


class EmbeddableItem(Protocol):
    category: str
    name: str
    artist: str | None
    description: str
    tags: list[str]
    ingredients: list[str]


def document_text(item: EmbeddableItem) -> str:
    tags = ", ".join(item.tags)
    if item.category == "food":
        parts = [f"음식. {item.description}", f"맛·특징: {tags}."]
        if item.ingredients:
            parts.append(f"재료: {', '.join(item.ingredients)}.")
        return f"title: {item.name} | text: {' '.join(parts)}"
    title = f"{item.name} - {item.artist}" if item.artist else item.name
    return f"title: {title} | text: 음악. {item.description} 분위기·장르: {tags}."


def query_text(raw: str, condition_tags: Sequence[str]) -> str | None:
    """Situation query for gemini-embedding-2. None when there is nothing situational to embed."""
    raw = " ".join(raw.split())
    if not raw and not condition_tags:
        return None
    return f"task: search result | query: 상황: {raw or '없음'}. 원하는 조건: {', '.join(condition_tags) or '없음'}"


def embedding_hash(model: str, dim: int, text: str) -> str:
    """Changes whenever the text, model or dimension changes, so stale vectors are re-embedded."""
    return hashlib.sha256(f"{model}\n{dim}\n{text}".encode("utf-8")).hexdigest()


def normalize(vector: Sequence[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0:
        raise ValueError("zero-length embedding")
    return [v / norm for v in vector]


class Embedder(Protocol):
    model: str
    dim: int

    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class GeminiEmbedder:
    def __init__(self, api_key: str, model: str, dim: int = EMBEDDING_DIM, batch_size: int = 50, client=None,
                 attempts: int = 3, timeout_ms: int | None = None):
        if dim != EMBEDDING_DIM:
            raise ValueError(f"embedding_dim {dim} does not match the vector({EMBEDDING_DIM}) column")
        if client is None:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=timeout_ms) if timeout_ms else None)
        self.client, self.model, self.dim, self.batch_size, self.attempts = client, model, dim, batch_size, attempts

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), self.batch_size):
            batch = list(texts[start:start + self.batch_size])
            vectors.extend(self._embed_batch(batch))
        return vectors

    def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        from google.genai import types

        attempts = self.attempts
        for attempt in range(attempts):
            try:
                # One Content per text: a plain list[str] is merged into a single embedding by gemini-embedding-2.
                response = self.client.models.embed_content(
                    model=self.model, contents=[types.Content(parts=[types.Part(text=t)]) for t in batch],
                    config=types.EmbedContentConfig(output_dimensionality=self.dim),
                )
                break
            except Exception as exc:
                if attempt == attempts - 1:
                    raise
                # The free tier counts every text as a request (100/min); a 429 says how long to wait.
                time.sleep(min(retry_delay(str(exc), 2 ** attempt), 70.0) if getattr(exc, "code", None) == 429 else 2 ** attempt)
        embeddings = response.embeddings or []
        # One vector per input; a merged multimodal embedding would silently mislabel items.
        if len(embeddings) != len(batch):
            raise RuntimeError(f"expected {len(batch)} embeddings, got {len(embeddings)}")
        vectors = [normalize(e.values) for e in embeddings]
        if any(len(v) != self.dim for v in vectors):
            raise RuntimeError(f"expected {self.dim}-dim embeddings")
        return vectors


class QueryEmbedder:
    """Embeds situation queries with a small in-memory LRU cache (same sentence → no API call)."""

    def __init__(self, embedder: Embedder, maxsize: int = 256):
        self.embedder, self.maxsize = embedder, maxsize
        self._cache: OrderedDict[str, list[float]] = OrderedDict()

    def __call__(self, text: str) -> list[float]:
        if text in self._cache:
            self._cache.move_to_end(text)
            return self._cache[text]
        [vector] = self.embedder.embed([text])
        self._cache[text] = vector
        if len(self._cache) > self.maxsize:
            self._cache.popitem(last=False)
        return vector

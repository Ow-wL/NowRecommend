from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# server/app/config.py → project root holds shared/vocab.json (same layout inside Docker).
PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://nowrecommend:nowrecommend@127.0.0.1:5433/nowrecommend"
    cors_origins: list[str] = ["http://127.0.0.1:5173", "http://localhost:5173", "https://ow-wl.github.io"]
    vocab_path: Path = PROJECT_ROOT / "shared" / "vocab.json"
    gemini_api_key: str | None = None
    embedding_model: str = "gemini-embedding-2"
    embedding_dim: int = 768  # must equal the vector(768) column
    llm_model: str = "gemini-3.6-flash"
    # Models the music lab may use for free recommendations (plans-music-ai.md); the first is the default.
    lab_free_models: list[str] = ["gemini-3.5-flash-lite", "gemini-3.6-flash"]
    # Calls per day (UTC, this process) for every lab model after the first: the free tier gives gemini-3.6-flash
    # only ~20 a day, and any visitor could otherwise spend it in a minute (review 2026-10-26). 0 = no cap.
    lab_extra_model_daily_limit: int = 10
    rerank_enabled: bool = True
    parse_enabled: bool = True  # LLM parsing, only for words the rule parser missed
    # The Gemini API rejects request deadlines under 10s with 400 INVALID_ARGUMENT (seen in R4).
    rerank_timeout_ms: int = Field(10000, ge=10000)
    db_connect_timeout: int = 3
    # Store request sentences in recommendation_logs (local/evaluation only; set false when deployed).
    log_raw_text: bool = True
    # POSTs to /api/recommend and /api/parse per client per minute (0 = off); TRUST_PROXY reads X-Forwarded-For.
    rate_limit_per_minute: int = 30
    trust_proxy: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()

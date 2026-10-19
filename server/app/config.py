from functools import lru_cache
from pathlib import Path

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
    db_connect_timeout: int = 3


@lru_cache
def get_settings() -> Settings:
    return Settings()

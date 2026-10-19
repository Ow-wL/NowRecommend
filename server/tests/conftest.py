import hashlib
import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, make_url, text
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.embeddings import normalize
from app.models import EMBEDDING_DIM

DB_TESTS = os.environ.get("NOWREC_DB_TESTS") == "1"
needs_db = pytest.mark.skipif(not DB_TESTS, reason="set NOWREC_DB_TESTS=1 with docker compose up db")


class FakeEmbedder:
    """Deterministic vectors derived from the text hash; records every call."""

    model, dim = "fake-embedding", EMBEDDING_DIM

    def __init__(self):
        self.calls: list[list[str]] = []

    def embed(self, texts):
        self.calls.append(list(texts))
        return [normalize([b - 127.5 for b in (hashlib.sha256(t.encode()).digest() * 24)[: self.dim]]) for t in texts]


@pytest.fixture(scope="session")
def test_database_url():
    """A separate <db>_test database, recreated and migrated to head once per run."""
    from alembic import command
    from alembic.config import Config

    base = make_url(get_settings().database_url)
    url = base.set(database=f"{base.database}_test")
    admin = create_engine(base, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    admin.dispose()
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = url.render_as_string(hide_password=False)
    get_settings.cache_clear()
    try:
        command.upgrade(Config(str(Path(__file__).resolve().parents[1] / "alembic.ini")), "head")
    finally:
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous
        get_settings.cache_clear()
    return url


@pytest.fixture
def db_session(test_database_url):
    engine = create_engine(test_database_url)
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE items, recommendation_logs"))
    with sessionmaker(engine, expire_on_commit=False)() as session:
        yield session
    engine.dispose()

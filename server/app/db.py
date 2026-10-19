from dataclasses import dataclass
from functools import lru_cache

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()
    return create_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args={"connect_timeout": settings.db_connect_timeout},
    )


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(get_engine(), expire_on_commit=False)


def get_session():
    with get_sessionmaker()() as session:
        yield session


@dataclass(frozen=True)
class DatabaseStatus:
    ok: bool
    pgvector_available: str | None = None
    pgvector_installed: str | None = None
    error: str | None = None


def check_database() -> DatabaseStatus:
    """Connectivity plus pgvector availability. The extension itself is created by migrations (R1)."""
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
            row = conn.execute(
                text("SELECT default_version, installed_version FROM pg_available_extensions WHERE name = 'vector'")
            ).first()
    except SQLAlchemyError as exc:
        # Only the error class: connection strings and hosts stay out of responses.
        return DatabaseStatus(ok=False, error=type(exc).__name__)
    return DatabaseStatus(ok=True, pgvector_available=row[0] if row else None, pgvector_installed=row[1] if row else None)

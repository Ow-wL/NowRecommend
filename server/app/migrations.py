"""Expand/contract migrations (DEPLOY.md §0).

An *expand* migration only adds what new code needs and old code ignores, so it is safe to apply while the previous
API revision still runs or may be rolled back to. A *contract* migration removes something old code still reads (0003
drops the price columns); its module sets `contract = True`, and it is applied only on request, after no old revision
serves traffic or remains a rollback target.

The API container and the seed job call `migrate()` (expand only); `python -m app.cli.migrate --contract` applies the
rest. Revisions are linear, so an expand migration added after a pending contract one waits for it.
"""
from dataclasses import dataclass, field
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine

from .config import get_settings

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


def alembic_config() -> Config:
    return Config(str(ALEMBIC_INI))


def current_revision() -> str | None:
    engine = create_engine(get_settings().database_url)
    try:
        with engine.connect() as connection:
            return MigrationContext.configure(connection).get_current_revision()
    finally:
        engine.dispose()


@dataclass
class Plan:
    current: str | None
    target: str | None                                   # revision to upgrade to; None when there is nothing to do
    waiting: list[str] = field(default_factory=list)     # pending contract migrations (and everything after them)


def plan(include_contract: bool = False) -> Plan:
    revisions = list(reversed(list(ScriptDirectory.from_config(alembic_config()).walk_revisions())))  # base → head
    current = current_revision()
    ids = [r.revision for r in revisions]
    if current is not None and current not in ids:
        raise RuntimeError(f"DB revision {current} is unknown to this code (rolled back to an older image?)")
    pending = revisions[ids.index(current) + 1:] if current else revisions
    target, waiting = None, []
    for index, revision in enumerate(pending):
        if getattr(revision.module, "contract", False) and not include_contract:
            waiting = [r.revision for r in pending[index:]]
            break
        target = revision.revision
    return Plan(current, target, waiting)


def migrate(include_contract: bool = False) -> Plan:
    result = plan(include_contract)
    if result.target:
        config = alembic_config()
        config.attributes["allow_contract"] = include_contract  # read by contract migrations (0003)
        command.upgrade(config, result.target)
    return result


def downgrade(revision: str) -> None:
    command.downgrade(alembic_config(), revision)

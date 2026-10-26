"""Expand/contract path of the price removal on a throwaway database (DEPLOY.md §0).

Old schema with prices (0002) → compatible code with expand-only migrations (0003 must not run) → contract (columns
dropped, values kept in items_price_backup) → rollback (downgrade to 0002 restores the columns and values).
The database is <dev db>_migration_test, created and dropped here; the development database itself is never migrated.
"""
import os

import pytest
from sqlalchemy import create_engine, inspect, make_url, text
from sqlalchemy.orm import sessionmaker

from app.catalog import load_seed, public_item, reviewed_items, seed_items
from app.config import get_settings
from app.vocab import get_vocab
from tests.conftest import needs_db

pytestmark = [pytest.mark.db, needs_db]

OLD_ITEM = ("f01", "food", "쌀국수", "9,000–12,000원", "국물", ["담백함"], ["밀"], "9,000–12,000원", 10000, "🍜", "#fff")


@pytest.fixture
def migration_db():
    base = make_url(get_settings().database_url)
    url = base.set(database=f"{base.database}_migration_test")
    assert url.database != base.database and url.database.endswith("_migration_test")
    admin = create_engine(base, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = url.render_as_string(hide_password=False)
    get_settings.cache_clear()
    engine = create_engine(url)
    try:
        yield engine
    finally:
        engine.dispose()
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous
        get_settings.cache_clear()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
        admin.dispose()


def columns(engine) -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns("items")}


def old_api_query(engine):
    """What the API from before the price removal selects for every item (its ORM maps both columns)."""
    with engine.connect() as conn:
        return conn.execute(text("SELECT id, price_label, cost FROM items WHERE id = 'f01'")).one()


def test_expand_keeps_old_code_working_and_contract_is_reversible(migration_db):
    from alembic import command

    from app.migrations import alembic_config, current_revision, downgrade, migrate, plan

    # 1. The database as the deployed (old) API left it: schema 0002 with prices.
    command.upgrade(alembic_config(), "0002")
    with migration_db.begin() as conn:
        conn.execute(text("INSERT INTO items (id, category, name, subtitle, description, tags, ingredients, price_label, cost, emoji, color, status, source) "
                          "VALUES (:id, :c, :n, :s, :d, :t, :i, :p, :cost, :e, :col, 'reviewed', 'seed')"),
                     dict(zip(["id", "c", "n", "s", "d", "t", "i", "p", "cost", "e", "col"], OLD_ITEM)))

    # 2. The compatible API starts: expand only. 0003 waits, the old query still works, and the new code runs too.
    started = migrate()
    assert started.target is None and started.waiting == ["0003"] and current_revision() == "0002"
    assert {"price_label", "cost"} <= columns(migration_db)
    assert old_api_query(migration_db) == ("f01", "9,000–12,000원", 10000)
    with sessionmaker(migration_db)() as session:
        seed_items(session, get_vocab(), load_seed())  # the seed job of the new image, columns still present
        food = [public_item(r) for r in reviewed_items(session, "food")]
    assert len(food) == 16 and all("price" not in i and "원" not in i["subtitle"] for i in food)
    assert old_api_query(migration_db) == ("f01", "9,000–12,000원", 10000)  # seeding never touches the old columns

    # The old seed job command (`alembic upgrade head`) on the new image stops at 0003 without changing anything.
    with pytest.raises(RuntimeError, match="contract migration"):
        command.upgrade(alembic_config(), "head")
    assert current_revision() == "0002" and {"price_label", "cost"} <= columns(migration_db)

    # 3. Contract, once no old revision runs: columns gone, values kept aside.
    assert plan(include_contract=True).target == "0003"
    migrate(include_contract=True)
    assert current_revision() == "0003" and not {"price_label", "cost"} & columns(migration_db)
    with migration_db.connect() as conn:
        assert conn.execute(text("SELECT id, price_label, cost FROM items_price_backup")).all() == [("f01", "9,000–12,000원", 10000)]
    assert migrate().target is None  # nothing left; the API restarts cleanly
    # server-ci.yml runs `alembic check` at head: the backup table is operational (UNMANAGED_TABLES), not a model drift.
    command.check(alembic_config())

    # 4. Rollback to an image from before the removal: downgrade first, then the old query works with its values.
    downgrade("0002")
    assert current_revision() == "0002" and old_api_query(migration_db) == ("f01", "9,000–12,000원", 10000)
    assert not inspect(migration_db).has_table("items_price_backup")
    migrate(include_contract=True)  # and forward again
    assert current_revision() == "0003"


def test_unknown_revision_is_reported_instead_of_guessed(migration_db):
    from alembic import command

    from app.migrations import alembic_config, plan

    command.upgrade(alembic_config(), "0002")
    with migration_db.begin() as conn:
        conn.execute(text("UPDATE alembic_version SET version_num = '9999'"))
    with pytest.raises(RuntimeError, match="unknown"):
        plan()


def test_only_listed_operational_tables_are_left_out_of_the_model_comparison():
    import importlib.util

    from app.models import UNMANAGED_TABLES

    spec = importlib.util.spec_from_file_location("migration_0003", "alembic/versions/0003_drop_item_price.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert UNMANAGED_TABLES == {module.BACKUP}  # the table 0003 creates, and nothing else

"""drop the reference price columns: the app no longer shows, filters or ranks by price (2026-10-27)

Contract migration (app/migrations.py): API revisions from before the price removal map these columns, so this runs
only through `python -m app.cli.migrate --contract`, after no such revision serves traffic or remains a rollback
target. The values are copied to items_price_backup first, and a downgrade puts them back, so an old image can be
restored after `python -m app.cli.migrate --downgrade 0002`.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-27
"""
import os

import sqlalchemy as sa
from alembic import context, op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None
contract = True

BACKUP = "items_price_backup"  # listed in app.models.UNMANAGED_TABLES, so `alembic check` leaves it alone


def upgrade() -> None:
    # A plain `alembic upgrade head` (e.g. the seed job's command from before the price removal, run on a new image)
    # must not drop the columns: only `app.cli.migrate --contract` (or NOWREC_ALLOW_CONTRACT=1, as in CI) may.
    if not (context.config.attributes.get("allow_contract") or os.environ.get("NOWREC_ALLOW_CONTRACT") == "1"):
        raise RuntimeError("0003 drops items.price_label/cost (contract migration). Run `python -m app.cli.migrate --contract` "
                           "once no API revision from before the price removal serves traffic or remains a rollback target "
                           "(DEPLOY.md §0). Nothing was changed.")
    op.execute(f"CREATE TABLE {BACKUP} AS SELECT id, price_label, cost FROM items WHERE price_label IS NOT NULL OR cost IS NOT NULL")
    op.drop_constraint("items_cost", "items", type_="check")
    op.drop_column("items", "cost")
    op.drop_column("items", "price_label")


def downgrade() -> None:
    op.add_column("items", sa.Column("price_label", sa.Text))
    op.add_column("items", sa.Column("cost", sa.Integer))
    op.create_check_constraint("items_cost", "items", "cost IS NULL OR cost > 0")
    # A database upgraded by the first version of this migration has no backup; its prices stay empty.
    if sa.inspect(op.get_bind()).has_table(BACKUP):
        op.execute(f"UPDATE items SET price_label = b.price_label, cost = b.cost FROM {BACKUP} b WHERE items.id = b.id")
        op.drop_table(BACKUP)

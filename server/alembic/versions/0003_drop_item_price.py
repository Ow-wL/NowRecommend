"""drop the reference price columns: the app no longer shows, filters or ranks by price (2026-10-27)

Contract migration (app/migrations.py): API revisions from before the price removal map these columns, so this runs
only through `python -m app.cli.migrate --contract`, after no such revision serves traffic or remains a rollback
target. The values are copied to items_price_backup first, and a downgrade puts them back, so an old image can be
restored after `python -m app.cli.migrate --downgrade 0002`.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-27
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None
contract = True

BACKUP = "items_price_backup"  # listed in app.models.UNMANAGED_TABLES, so `alembic check` leaves it alone


def upgrade() -> None:
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

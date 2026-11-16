"""users.store_version: a counter that lets an upload be refused when another device saved first (2026-11-16)

Expand migration: a defaulted column older code ignores. Rolling the API back to an image from before this revision
needs `python -m app.cli.migrate --downgrade 0006` first: that image does not know 0007 and refuses to start on it
(app/migrations.py). The downgrade drops the counter; the old API then saves unconditionally, as it always did, and a
newer browser reads and merges before each save because the answers carry no version (src/sync.ts). Upgrading again
starts every stored account at 1, which a browser that remembers a higher number answers by reading and merging.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-16
"""
import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("store_version", sa.Integer, nullable=False, server_default="0"))
    # Accounts that already hold a store start at 1, so "0" keeps meaning "nothing saved yet".
    op.execute("UPDATE users SET store_version = 1 WHERE store IS NOT NULL")


def downgrade() -> None:
    op.drop_column("users", "store_version")

"""usage_daily: per-day counters for the AI budget and sign-ups (2026-11-17)

Expand migration: a new table older code never reads. See app/budget.py. As with 0007, an image from before this
revision does not start on it; roll back with `python -m app.cli.migrate --downgrade 0007` (or 0006) first.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-17
"""
import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "usage_daily",
        sa.Column("day", sa.Date, primary_key=True),
        sa.Column("bucket", sa.Text, primary_key=True),
        sa.Column("count", sa.Integer, nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("usage_daily")

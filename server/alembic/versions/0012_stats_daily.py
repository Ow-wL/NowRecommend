"""stats_daily: how many times a day each feature was used, and how many browsers came (2026-11-23)

Counts only: no account, address or browser is kept, so nothing in it is about a person. The admin page draws its
dashboard from it. Expand migration (a new table older code ignores); as with 0009-0011, an image from before this
revision does not start on it, so downgrade to the revision that image knows first.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-23
"""
import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stats_daily",
        sa.Column("day", sa.Date, primary_key=True),
        sa.Column("name", sa.Text, primary_key=True),
        sa.Column("count", sa.Integer, nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("stats_daily")

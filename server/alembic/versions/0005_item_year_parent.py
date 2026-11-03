"""items: release year (music) and parent dish (food detail menus), 2026-11-03

Expand migration: two nullable columns and an index, which older code ignores. `parent_id` points a detail menu at the
general dish it belongs to (뿌링클 → 치킨), which also lends it that dish's photo. `release_year` lets the catalog be read
and filtered by year; it is the earliest year the store lists for the song, so a re-release does not make an old song new.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-03
"""
import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("items", sa.Column("release_year", sa.Integer, nullable=True))
    op.add_column("items", sa.Column("parent_id", sa.Text, nullable=True))
    op.create_index("items_release_year", "items", ["category", "release_year"])


def downgrade() -> None:
    op.drop_index("items_release_year", table_name="items")
    op.drop_column("items", "parent_id")
    op.drop_column("items", "release_year")

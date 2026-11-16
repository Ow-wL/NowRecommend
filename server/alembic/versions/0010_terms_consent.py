"""users.terms_version, terms_agreed_at: what a person agreed to at sign-up, and when (2026-11-17)

Expand migration: two nullable columns older code ignores. Accounts made before this have no record (NULL). As with
0009, an image from before this revision does not start on it; downgrade to the revision that image knows first.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-17
"""
import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("terms_version", sa.Text, nullable=True))
    op.add_column("users", sa.Column("terms_agreed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "terms_agreed_at")
    op.drop_column("users", "terms_version")

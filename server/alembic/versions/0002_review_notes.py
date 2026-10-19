"""review notes left by AI drafting (e.g. a song the model did not recognise)

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-19
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("items", sa.Column("review_notes", ARRAY(sa.Text), nullable=False, server_default="{}"))


def downgrade() -> None:
    op.drop_column("items", "review_notes")

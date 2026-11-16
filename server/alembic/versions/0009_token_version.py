"""users.token_version: a number every session token carries, so one account's tokens can be ended (2026-11-17)

Expand migration: a defaulted column older code ignores. Tokens issued before this revision carry no number and count
as 0, so everyone stays signed in until their password changes or they sign out everywhere. As with 0007, an image
from before this revision does not start on it; roll back with `python -m app.cli.migrate --downgrade 0006` first.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-17
"""
import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("token_version", sa.Integer, nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("users", "token_version")

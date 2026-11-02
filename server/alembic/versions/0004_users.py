"""accounts: users with a password hash and their synced browser store (plans-rag.md §12 decision 1, 2026-11-02)

Expand migration: a new table only. Revisions are linear, so on a database still at 0002 this waits behind the
contract migration 0003 until `python -m app.cli.migrate --contract` has run (DEPLOY.md §0, §6).

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-02
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    now = sa.text("now()")
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("store", JSONB, nullable=True),
        sa.Column("store_updated_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("last_login_at", sa.DateTime(timezone=True)),
    )
    op.create_index("users_email", "users", ["email"], unique=True)


def downgrade() -> None:
    op.drop_table("users")

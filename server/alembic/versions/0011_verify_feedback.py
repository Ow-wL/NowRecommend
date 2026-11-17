"""users.email_verified_at, and feedback: a confirmed address, and what people tell the service (2026-11-18)

Expand migration: a nullable column and a new table, which older code ignores. Accounts made before this have no
confirmation (NULL); with EMAIL_VERIFICATION on they sign in again only after confirming (routes/auth.py). Feedback is
not tied to an account: what was said, and an address to answer only if the person wrote one. As with 0009 and 0010, an image from
before this revision does not start on it; downgrade to the revision that image knows first.

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-18
"""
import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "feedback",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("contact", sa.Text, nullable=True),
        sa.Column("page", sa.Text, nullable=False, server_default=""),
        sa.Column("app_version", sa.Text, nullable=False, server_default=""),
        sa.CheckConstraint("kind IN ('praise','problem','idea','other')", name="feedback_kind"),
    )
    op.create_index("feedback_created", "feedback", ["created_at"])


def downgrade() -> None:
    op.drop_index("feedback_created", table_name="feedback")
    op.drop_table("feedback")
    op.drop_column("users", "email_verified_at")

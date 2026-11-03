"""reports: errors people flag on a card, and the flag that lets an account read them (2026-11-03)

Expand migration: a new table and a defaulted column, which older code ignores. Admin is a column set by app.cli.admin,
never derived from an address: sign-up does not verify email, so anyone could register an address on an allow list.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-03
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_admin", sa.Boolean, nullable=False, server_default=sa.false()))
    op.create_table(
        "reports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("item_id", sa.Text, nullable=False),
        sa.Column("category", sa.Text, nullable=False),
        sa.Column("item_name", sa.Text, nullable=False),
        sa.Column("item_subtitle", sa.Text, nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("note", sa.Text, nullable=False, server_default=""),
        sa.Column("status", sa.Text, nullable=False, server_default="open"),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('wrong_image','wrong_info','not_exist','other')", name="reports_kind"),
        sa.CheckConstraint("status IN ('open','resolved','dismissed')", name="reports_status"),
    )
    op.create_index("reports_status_created", "reports", ["status", "created_at"])


def downgrade() -> None:
    op.drop_index("reports_status_created", table_name="reports")
    op.drop_table("reports")
    op.drop_column("users", "is_admin")

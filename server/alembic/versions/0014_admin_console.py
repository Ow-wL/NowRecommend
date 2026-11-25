"""admin console: suspended accounts, feedback handling, items hidden by an admin, the admin action record (2026-11-26)

- users.suspended_at / suspended_reason: an admin stopped this account (terms §이용 제한). A suspended account accepts no
  token and cannot sign in or reset its password (routes/auth.py).
- feedback.status / handled_at / note: whether an admin dealt with it, and a note only admins read.
- items.hidden_at: an admin took the item out of recommendations (its review status is kept); the seed job leaves it hidden.
- admin_audit: what an admin did or looked at, to what, and why; kept two years (retention.py).

Expand migration (new nullable columns and a new table older code ignores). An image from before this revision does not
start on it (the startup check wants the head it knows), so downgrade first to go back.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-26
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Waits at most a few seconds for a busy table instead of queueing every request behind this migration.
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column("users", sa.Column("suspended_at", sa.DateTime(timezone=True)))
    op.add_column("users", sa.Column("suspended_reason", sa.Text))
    op.add_column("feedback", sa.Column("status", sa.Text, nullable=False, server_default="new"))
    op.add_column("feedback", sa.Column("handled_at", sa.DateTime(timezone=True)))
    op.add_column("feedback", sa.Column("note", sa.Text, nullable=False, server_default=""))
    op.create_check_constraint("feedback_status", "feedback", "status IN ('new','done')")
    op.add_column("items", sa.Column("hidden_at", sa.DateTime(timezone=True)))
    op.create_table(
        "admin_audit",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("actor_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("actor_email", sa.Text, nullable=False),
        sa.Column("action", sa.Text, nullable=False),
        sa.Column("target_type", sa.Text, nullable=False),
        sa.Column("target_id", sa.Text, nullable=False),
        sa.Column("reason", sa.Text, nullable=False, server_default=""),
        sa.Column("detail", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index("admin_audit_at", "admin_audit", ["at"])
    op.create_index("admin_audit_target", "admin_audit", ["target_type", "target_id"])
    # The member list sorts and filters by these (routes/admin.py).
    op.create_index("users_created_at", "users", ["created_at"])
    op.create_index("access_log_address", "access_log", ["address", "at"])


def downgrade() -> None:
    op.drop_index("access_log_address", table_name="access_log")
    op.drop_index("users_created_at", table_name="users")
    op.drop_index("admin_audit_target", table_name="admin_audit")
    op.drop_index("admin_audit_at", table_name="admin_audit")
    op.drop_table("admin_audit")
    op.drop_column("items", "hidden_at")
    op.drop_constraint("feedback_status", "feedback", type_="check")
    op.drop_column("feedback", "note")
    op.drop_column("feedback", "handled_at")
    op.drop_column("feedback", "status")
    op.drop_column("users", "suspended_reason")
    op.drop_column("users", "suspended_at")

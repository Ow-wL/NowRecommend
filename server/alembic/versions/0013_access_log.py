"""access_log: who came in, for the admin page (2026-11-24)

The address (IP) and time of a visit, a sign-up, a login and a recommendation, kept 30 days (retention.py) as the privacy
policy's "접속 기록" already says: to look into abuse and failures. Not linked to an account. Expand migration (a new
table older code ignores); an image from before this revision does not start on it, so downgrade first to go back.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-24
"""
import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "access_log",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("address", sa.Text, nullable=False),
        sa.Column("event", sa.Text, nullable=False),
    )
    op.create_index("access_log_at", "access_log", ["at"])
    # The admin page's insights read the request log by date (routes/stats.py).
    op.create_index("recommendation_logs_created_at", "recommendation_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("recommendation_logs_created_at", table_name="recommendation_logs")
    op.drop_index("access_log_at", table_name="access_log")
    op.drop_table("access_log")

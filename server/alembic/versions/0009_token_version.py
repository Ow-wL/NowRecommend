"""users.token_version: a number every session token carries, so one account's tokens can be ended (2026-11-17)

Expand migration: a defaulted column older code ignores. Tokens issued before this revision carry no number and count
as 0, so everyone stays signed in until their password changes or they sign out everywhere.

Rolling back: an image from before this revision does not start on it, so downgrade first, to the revision that image
knows (`python -m app.cli.migrate --downgrade 0008` for the one just before; 0006 for the images of 2026-11-10 and
earlier). The downgrade drops the numbers, and that older code does not check them anyway: every session that was
ended (a changed password, "sign out everywhere") would be accepted again until it expires. So a rollback below this
revision also rotates AUTH_SECRET, which signs everyone out.

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

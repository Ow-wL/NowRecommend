"""items catalog with pgvector embeddings, recommendation logs

Revision ID: 0001
Revises:
Create Date: 2026-10-19
"""
import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    text_array = ARRAY(sa.Text)
    now = sa.text("now()")
    op.create_table(
        "items",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("category", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("artist", sa.Text),
        sa.Column("subtitle", sa.Text, nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("tags", text_array, nullable=False),
        sa.Column("ingredients", text_array, nullable=False, server_default="{}"),
        sa.Column("price_label", sa.Text),
        sa.Column("cost", sa.Integer),
        sa.Column("emoji", sa.Text, nullable=False),
        sa.Column("color", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="draft"),
        sa.Column("source", sa.Text, nullable=False),
        sa.Column("ai_fields", text_array, nullable=False, server_default="{}"),
        sa.Column("embedding", Vector(768)),
        sa.Column("embedding_model", sa.Text),
        sa.Column("embedding_hash", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("category IN ('food','music')", name="items_category"),
        sa.CheckConstraint("status IN ('draft','reviewed','rejected')", name="items_status"),
        sa.CheckConstraint("source IN ('seed','ai_draft','user_request')", name="items_source"),
        sa.CheckConstraint("cost IS NULL OR cost > 0", name="items_cost"),
    )
    op.create_index(
        "items_unique_name", "items",
        ["category", sa.text("lower(name)"), sa.text("coalesce(lower(artist), '')")], unique=True,
    )
    op.create_index("items_ingredients", "items", ["ingredients"], postgresql_using="gin")
    op.create_index("items_tags", "items", ["tags"], postgresql_using="gin")
    # ~300 items: exact scan is fast enough, so no HNSW index yet (plans-rag.md §5).

    op.create_table(
        "recommendation_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("category", sa.Text, nullable=False),
        sa.Column("raw_text", sa.Text),
        sa.Column("conditions", JSONB, nullable=False),
        sa.Column("params", JSONB, nullable=False),
        sa.Column("candidate_ids", text_array, nullable=False),
        sa.Column("candidate_scores", JSONB, nullable=False),
        sa.Column("result_ids", text_array, nullable=False),
        sa.Column("mode", sa.Text, nullable=False),
        sa.Column("latency_ms", sa.Integer),
        sa.Column("error", sa.Text),
        sa.CheckConstraint("mode IN ('rag','retrieval_only')", name="logs_mode"),
    )


def downgrade() -> None:
    op.drop_table("recommendation_logs")
    op.drop_table("items")

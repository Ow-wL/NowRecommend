import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import ARRAY, CheckConstraint, DateTime, Index, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Fixed by the migration (vector(768)); settings.embedding_dim must match.
EMBEDDING_DIM = 768
# Tables migrations create for operations, not for the app, so they have no model: autogenerate and `alembic check`
# (server-ci.yml) skip them instead of proposing to drop them (alembic/env.py). items_price_backup: the price values
# 0003 removed, kept so `app.cli.migrate --downgrade 0002` can restore them.
UNMANAGED_TABLES = frozenset({"items_price_backup"})


class Base(DeclarativeBase):
    pass


class Item(Base):
    __tablename__ = "items"
    __table_args__ = (
        CheckConstraint("category IN ('food','music')", name="items_category"),
        CheckConstraint("status IN ('draft','reviewed','rejected')", name="items_status"),
        CheckConstraint("source IN ('seed','ai_draft','user_request')", name="items_source"),
        Index("items_unique_name", "category", text("lower(name)"), text("coalesce(lower(artist), '')"), unique=True),
        Index("items_ingredients", "ingredients", postgresql_using="gin"),
        Index("items_tags", "tags", postgresql_using="gin"),
    )

    # Existing ids (f01, m01…) are kept so browser-stored tastes and history keep matching.
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    category: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    artist: Mapped[str | None] = mapped_column(Text)
    subtitle: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text))
    ingredients: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    emoji: Mapped[str] = mapped_column(Text)
    color: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="draft")
    source: Mapped[str] = mapped_column(Text)
    ai_fields: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    review_notes: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")  # warnings for the reviewer
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM))
    embedding_model: Mapped[str | None] = mapped_column(Text)
    embedding_hash: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RecommendationLog(Base):
    __tablename__ = "recommendation_logs"
    __table_args__ = (CheckConstraint("mode IN ('rag','retrieval_only')", name="logs_mode"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    category: Mapped[str] = mapped_column(Text)
    raw_text: Mapped[str | None] = mapped_column(Text)
    conditions: Mapped[dict] = mapped_column(JSONB)
    params: Mapped[dict] = mapped_column(JSONB)
    candidate_ids: Mapped[list[str]] = mapped_column(ARRAY(Text))
    candidate_scores: Mapped[dict] = mapped_column(JSONB)
    result_ids: Mapped[list[str]] = mapped_column(ARRAY(Text))
    mode: Mapped[str] = mapped_column(Text)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)

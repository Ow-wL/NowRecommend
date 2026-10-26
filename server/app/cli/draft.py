"""AI drafts from a names file: python -m app.cli.draft --category food data/drafts/food-names.txt

food: one menu per line. music: '제목 - 아티스트' per line (or CSV with name,artist).
Drafts stay out of recommendations until approved with app.cli.review. Uses ~1 generate call per
--batch names (free tier: ~20 calls/day).
"""
import argparse
import sys
from pathlib import Path

from ..config import get_settings
from ..db import get_sessionmaker
from ..drafting import draft_items, read_inputs
from ..embeddings import GeminiEmbedder
from ..llm.provider import shared_model
from ..vocab import get_vocab


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("names", type=Path)
    parser.add_argument("--category", choices=["food", "music"], required=True)
    parser.add_argument("--batch", type=int, default=10, help="names per model request")
    parser.add_argument("--retries", type=int, default=2, help="retries per batch after a 503 overload or its cooldown")
    parser.add_argument("--dry-run", action="store_true", help="only list what would be drafted")
    args = parser.parse_args()
    inputs = read_inputs(args.names, args.category)
    if args.dry_run:
        print(f"{len(inputs)} names read: " + ", ".join(i.label for i in inputs))
        return
    model, settings = shared_model(), get_settings()
    if model is None:
        sys.exit("GEMINI_API_KEY is not set")
    embedder = GeminiEmbedder(settings.gemini_api_key, settings.embedding_model, settings.embedding_dim)
    with get_sessionmaker()() as session:
        report = draft_items(session, model, embedder, get_vocab(), args.category, inputs, args.batch, retries=args.retries)
    print(f"drafted {len(report.created)} items" + ("" if report.embedded or not report.created else " (embedding failed: duplicates checked by name only)"))
    for label, reason in report.skipped:
        print(f"  skipped {label}: {reason}")
    print("next: python -m app.cli.review export")


if __name__ == "__main__":
    main()

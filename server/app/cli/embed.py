"""Embed reviewed items whose text changed: python -m app.cli.embed [--dry-run] [--force]"""
import argparse
import sys

from ..catalog import refresh_embeddings
from ..config import get_settings
from ..db import get_sessionmaker
from ..embeddings import GeminiEmbedder


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="list items that need embedding without calling the API")
    parser.add_argument("--force", action="store_true", help="re-embed every reviewed item")
    args = parser.parse_args()
    settings = get_settings()
    if not settings.gemini_api_key and not args.dry_run:
        sys.exit("GEMINI_API_KEY is not set")
    embedder = GeminiEmbedder(settings.gemini_api_key or "", settings.embedding_model, settings.embedding_dim) if not args.dry_run else _DryRun(settings)
    with get_sessionmaker()() as session:
        ids = refresh_embeddings(session, embedder, force=args.force, dry_run=args.dry_run)
    verb = "would embed" if args.dry_run else "embedded"
    print(f"{verb} {len(ids)} items with {settings.embedding_model}/{settings.embedding_dim}" + (f": {', '.join(ids)}" if ids else ""))


class _DryRun:
    def __init__(self, settings):
        self.model, self.dim = settings.embedding_model, settings.embedding_dim

    def embed(self, texts):
        raise AssertionError("dry run never embeds")


if __name__ == "__main__":
    main()

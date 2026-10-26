#!/bin/sh
# Cloud Run job nowrecommend-seed (DEPLOY.md §2): expand migrations only, then the catalog seed and embeddings.
# Contract migrations (e.g. 0003 dropping the price columns) are never run here; see DEPLOY.md §0.
set -e
python -m app.cli.migrate
python -m app.cli.seed
python -m app.cli.embed

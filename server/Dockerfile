# Build context is the project root so shared/vocab.json is available (see docker-compose.yml).
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY shared/ shared/
COPY server/ server/
RUN pip install --no-cache-dir -e ./server
WORKDIR /srv/server
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"
# Expand migrations only: a contract migration (e.g. 0003 dropping the price columns) would break an older revision
# still running or kept for rollback, so it waits for `python -m app.cli.migrate --contract` (DEPLOY.md §0).
CMD ["sh", "-c", "python -m app.cli.migrate && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]

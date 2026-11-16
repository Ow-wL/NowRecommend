# Build context is the project root so shared/vocab.json is available (see docker-compose.yml).
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY shared/ shared/
COPY server/ server/
# Exact versions first (requirements.lock), then the app itself without resolving anything again.
RUN pip install --no-cache-dir -r server/requirements.lock && pip install --no-cache-dir --no-deps -e ./server
# The server needs to write nothing to its own files, so it does not run as root: a flaw in the app or a library is
# then not a flaw with the whole container's rights.
RUN useradd --system --no-create-home --uid 10001 app
USER app
WORKDIR /srv/server
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"
# Expand migrations only: a contract migration (e.g. 0003 dropping the price columns) would break an older revision
# still running or kept for rollback, so it waits for `python -m app.cli.migrate --contract` (DEPLOY.md §0).
CMD ["sh", "-c", "python -m app.cli.migrate && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]

# Play Metrics — production container.
FROM python:3.11-slim

# System libs: OpenCV (headless) runtime + ffmpeg for robust video I/O.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PLAYMETRICS_DATA=/data/runs \
    PLAYMETRICS_DB=/data/playmetrics.db

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Persistent data (job outputs + SQLite) lives on a mounted volume.
RUN mkdir -p /data/runs && useradd -m app && chown -R app /app /data
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health')" || exit 1

# Honour the platform-provided $PORT (Render/Railway/Fly); default 8000.
CMD ["sh", "-c", "uvicorn openpitch.api:app --host 0.0.0.0 --port ${PORT:-8000}"]

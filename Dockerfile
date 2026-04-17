# Backend image: FastAPI + Claude Agent SDK (bundled CLI ships in the wheel).
FROM python:3.13-slim

RUN pip install --no-cache-dir uv \
    && useradd --create-home --shell /bin/bash app

WORKDIR /app

COPY --chown=app:app pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev && chown -R app:app /app

COPY --chown=app:app agent_auth.py ./
COPY --chown=app:app server ./server

USER app

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uv run uvicorn server.main:app --host 0.0.0.0 --port ${PORT}"]

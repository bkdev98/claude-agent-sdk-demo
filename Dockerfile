# Backend image: FastAPI + Claude Agent SDK (bundled CLI ships in the wheel).
FROM python:3.13-slim

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY agent_auth.py ./
COPY server ./server

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uv run uvicorn server.main:app --host 0.0.0.0 --port ${PORT}"]

# Deploying agent-sdk-demo to Railway

Two services in one Railway project: a Python FastAPI **backend** and a Next.js **frontend**. Backend spawns the bundled Claude Code CLI and streams responses; frontend talks to it over SSE.

## TL;DR

- One Railway **project** with two **services** rooted at `/` (backend) and `/web` (frontend).
- Backend service needs `CLAUDE_CODE_OAUTH_TOKEN` so the spawned CLI can auth headlessly.
- Frontend service needs `NEXT_PUBLIC_BACKEND_URL` set to the backend's public URL.
- Backend must allow the frontend's origin via `ALLOW_ORIGINS`.

---

## Auth caveat — read this first

The local demo intentionally **scrubs** `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` from the spawned CLI's environment so it has to use the user's stored login (`claude /login`). On Railway there is no interactive login and no persistent home — you **must** authenticate via a token.

Generate one locally:

```bash
claude setup-token        # opens a browser, prints a long-lived token
```

Copy the token; you'll set it as `CLAUDE_CODE_OAUTH_TOKEN` on the backend service.

`agent_auth.py` already has the toggle: set `AUTH_MODE=token` on the backend service and the OAuth token will pass through to the spawned CLI.

---

## Backend service

`Dockerfile` (project root) and `.dockerignore` are already committed. CORS is already wired to the `ALLOW_ORIGINS` env var.

### Env vars to set on Railway (backend)

| Var | Value | Purpose |
| --- | --- | --- |
| `AUTH_MODE` | `token` | Stops `agent_auth.py` from stripping the OAuth token |
| `CLAUDE_CODE_OAUTH_TOKEN` | output of `claude setup-token` | Headless CLI auth |
| `ALLOW_ORIGINS` | `https://web-…up.railway.app` | CORS allow-list (must include the `https://` scheme; comma-separate multiple origins) |
| `PORT` | (Railway injects this) | Uvicorn binds to it |

---

## Frontend service

`web/Dockerfile` is already committed. It's a multi-stage Next 16 build that takes `NEXT_PUBLIC_BACKEND_URL` as a build-arg (Next inlines it at build time, so a runtime env var alone won't work). Railway exposes service env vars as build args automatically.

### Env vars to set on Railway (frontend)

| Var | Value |
| --- | --- |
| `NEXT_PUBLIC_BACKEND_URL` | `https://backend-…up.railway.app` |

---

## Step-by-step on Railway

1. Push this repo to GitHub.
2. Create a new Railway project → "Deploy from GitHub repo".
3. **Backend service**
   - Source: same repo, root `/`.
   - Builder: Dockerfile.
   - Set env: `AUTH_MODE=token`, `CLAUDE_CODE_OAUTH_TOKEN=…`, leave `ALLOW_ORIGINS` empty for now.
   - Generate a public domain → note the URL (e.g. `https://api-xyz.up.railway.app`).
4. **Frontend service** (Add Service → GitHub repo)
   - Source: same repo, root `/web`.
   - Builder: Dockerfile.
   - Set env `NEXT_PUBLIC_BACKEND_URL` to the backend URL from step 3.
   - Generate a public domain → note the URL.
5. Go back to backend, set `ALLOW_ORIGINS` to the frontend URL, redeploy backend.
6. Open the frontend URL → send a prompt. You should see a streamed PONG.

---

## Verification

Backend health check:

```bash
curl -fsS https://api-xyz.up.railway.app/api/health
# {"ok":true,"stripped_auth_env":[]}        ← stripped_auth_env should be [] in token mode
```

Direct SSE chat:

```bash
curl -N -X POST https://api-xyz.up.railway.app/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Say PONG."}'
```

You should see `event: text` with `PONG` and an `event: done` with the cost.

---

## Notes & gotchas

- The Python SDK ships the Claude Code CLI as a **bundled binary** inside the wheel. The `python:3.13-slim` Linux image runs it fine; no extra install needed.
- Tools that need shell or filesystem access (`Bash`, `Write`, …) **will run inside the Railway container**. The CLI's `cwd` is the container's WORKDIR — be careful with `/tools all` in production.
- Railway gives backend services 8 GB RAM by default; the SDK + bundled CLI use ~150 MB resident, so the `starter` plan is fine for low-volume demos.
- For private demos, put the frontend behind Railway's edge auth or add a simple bearer-token check in `server/main.py`.


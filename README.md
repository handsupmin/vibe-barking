# vibe-barking

A local-only parody of vibe coding where guarded “dog typing” becomes queued LLM work and live browser output.

## What is in this repo

- `frontend/` — React + Vite browser shell
- `helper/` — local Node helper that validates providers and dispatches queued jobs
- `scripts/` — local verification helpers
- `verification/contracts/` — contract fixtures for guarded input, chunking, provider validation, and preview isolation
- `docs/verification.md` — manual verification notes

## Recommended local setup

### 1) Frontend dev proxy

Create `frontend/.env.local`:

```bash
VITE_HELPER_PROXY_TARGET=http://127.0.0.1:4318
```

If you leave this unset, the frontend defaults to `http://127.0.0.1:4318` anyway.

### 2) Helper environment

The helper now **auto-loads `helper/.env.local`** on startup and UI-side provider validation writes back into that file for future launches.

Minimum optional helper host settings:

```bash
HELPER_HOST=127.0.0.1
HELPER_PORT=4318
```

Provider envs you can set locally:

```bash
# OpenAI
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini

# Gemini
GEMINI_API_KEY=...
# or GOOGLE_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash

# Claude
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-5

# Claude Code CLI
CLAUDE_CODE_CLI_PATH=claude
# or CLAUDE_CODE_BIN=/absolute/path/to/claude
CLAUDE_CODE_MODEL=sonnet

# Codex CLI
CODEX_CLI_PATH=codex
# or CODEX_BIN=/full/path/to/codex
CODEX_MODEL=gpt-5.4
```

Notes:
- `OPENAI_MODEL`, `GEMINI_MODEL`, `ANTHROPIC_MODEL`, `CLAUDE_CODE_MODEL`, and `CODEX_MODEL` are optional **if** you keep the frontend’s default model selections.
- `CLAUDE_CODE_CLI_PATH` / `CLAUDE_CODE_BIN` is only needed if `claude` is not already on your `PATH`.
- `CODEX_CLI_PATH` / `CODEX_BIN` is only needed if `codex` is not already on your `PATH`.
- Claude Code validation is helper-side only. If Claude Code is already authenticated on your machine, that may be enough; otherwise `ANTHROPIC_API_KEY` also helps for end-to-end validation.
- Codex validation is helper-side only. If Codex CLI is already authenticated on your machine, that may be enough; otherwise `OPENAI_API_KEY` also helps for end-to-end validation.

## Fast local run

From repo root:

```bash
npm run dev
```

That starts **helper + frontend together**.  
Press `Ctrl+C` once to stop both.

## How to run locally (manual split mode)

### Terminal 1 — helper

```bash
cd helper
npm install
npm start
```

The helper listens on `http://127.0.0.1:4318` by default.

### Terminal 2 — frontend

```bash
cd frontend
npm install
npm run dev
```

Then open the Vite URL, usually `http://127.0.0.1:5173`.

Because `/api` is proxied to the helper, provider validation and queue dispatch should work in local dev without changing client code.

## Fast verification

From repo root:

```bash
npm run verify
```

Equivalent expanded checks:

```bash
cd frontend && npm test && npm run lint && npm run typecheck && npm run build
cd ../helper && npm test && npm run typecheck
cd .. && node --test scripts/provider-env-check.test.mjs scripts/generate-chaos-input.test.mjs scripts/verification-contracts.test.mjs
```

## Real provider readiness check

From repo root:

```bash
node scripts/provider-env-check.mjs --provider all
```

That tells you which providers are ready from env, missing, or require manual Claude/Codex CLI auth verification.

## Sustained random-input check

Generate a deterministic bark string:

```bash
node scripts/generate-chaos-input.mjs --length 240 --seed 7
```

Paste that into the bark pad and confirm:
- every 20 accepted characters becomes one queue job
- queue rows move through expected states
- preview updates safely
- provider validation remains helper-only

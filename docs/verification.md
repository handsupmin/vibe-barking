# Verification Guide

This lane owns verification artifacts that can be prepared without taking feature ownership of the frontend or helper packages.

At the time this guide was written, the repository was still being split across parallel lanes:

- `frontend/` was only an initial Vite scaffold in `worker-1`
- `helper/` had not landed yet in `worker-2`

That means the runnable product tests still need to be wired into those packages once their commits are available in this worktree. The artifacts below are meant to keep that wiring deterministic.

## Verification artifacts in this lane

- `scripts/provider-env-check.mjs` — local readiness check for provider env vars and Codex CLI availability
- `verification/contracts/guarded-input.json` — expected guarded-input acceptance/rejection cases
- `verification/contracts/queue-chunking.json` — expected 20-character batching behavior
- `verification/contracts/provider-validation.json` — provider validation and Codex-policy contract
- `verification/contracts/preview-isolation.json` — preview iframe isolation contract

## Contract matrix

| Area | Contract source | Required outcome |
| --- | --- | --- |
| Guarded input | `verification/contracts/guarded-input.json` | Accept only letters/numbers across languages when no modifier keys are active; ignore functional keys and punctuation |
| Queue chunking | `verification/contracts/queue-chunking.json` | Emit one queued job for every accepted 20 characters and retain any remainder |
| Provider validation | `verification/contracts/provider-validation.json` | Require real config for OpenAI, Gemini, Claude, and Codex; keep Codex execution helper-only |
| Preview isolation | `verification/contracts/preview-isolation.json` | Render generated output in a sandboxed preview container, not by injecting into the app shell |

## Env-gated provider checks

Run:

```bash
node scripts/provider-env-check.mjs --provider all
```

Expected local inputs:

- OpenAI: `OPENAI_API_KEY`
- Gemini: `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- Claude: `ANTHROPIC_API_KEY`
- Codex CLI:
  - `codex` available on `PATH`, or
  - `CODEX_BIN` / `CODEX_CLI_PATH` pointing to the binary

### Codex CLI note

The readiness script can confirm that the Codex CLI binary is available, but it cannot reliably prove whether local interactive auth is already configured. If `OPENAI_API_KEY` is absent, treat Codex as **manual verification required** and confirm a real helper-side validation request succeeds on the developer machine.

## Merge follow-up once feature lanes land

1. Wire `guarded-input.json` into frontend unit tests.
2. Wire `queue-chunking.json` into frontend/session-state tests.
3. Wire `provider-validation.json` into helper validation and Codex policy tests.
4. Add a frontend preview test that enforces the `preview-isolation.json` iframe sandbox rules.
5. Run a sustained random-input smoke pass with at least 200 accepted characters and confirm:
   - exactly one queued job per completed 20-character block
   - queue states transition cleanly
   - preview updates do not break the shell UI

## Manual smoke checklist

After the feature lanes merge into one worktree:

1. Start the helper and frontend locally.
2. Run `node scripts/provider-env-check.mjs --provider all`.
3. Validate each provider individually from the helper UI/API.
4. Paste or type a long alphanumeric multilingual string.
5. Confirm every 20 accepted characters produces one queued job.
6. Confirm queue rows progress through `queued`, `processing`, and terminal states.
7. Confirm the preview uses an isolated iframe and cannot navigate or mutate the parent app shell.


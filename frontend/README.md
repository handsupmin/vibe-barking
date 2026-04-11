# vibe-barking frontend

Browser shell for the local vibe-barking demo.

## Local dev

1. Create `frontend/.env.local` (optional if you use the default helper port):

```bash
VITE_HELPER_PROXY_TARGET=http://127.0.0.1:4318
```

2. Install and start:

```bash
npm install
npm run dev
```

`/api` requests proxy to the helper in both Vite dev and Vite preview.

Provider validation persists through the helper's `helper/.env.local`, so API keys and CLI paths saved from the setup UI become the helper's default local config next time you launch it.

## Verification

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

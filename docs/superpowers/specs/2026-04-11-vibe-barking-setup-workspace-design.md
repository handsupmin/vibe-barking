# vibe-barking setup/workspace redesign

## Context
The current browser shell mixes provider setup, provider error states, Bark input, chunk pipeline, and preview into one surface. That causes first-run confusion, especially when provider validation fails and every provider tile appears broken at once. The product needs a clearer first-run gate and a calmer working surface.

## Approved goals
- First visit starts in a setup gate, not the workspace.
- User must pick exactly one provider and validate it successfully before entering the workspace.
- Validation failure shows a clear reason, then returns the user to the initial provider selection state.
- After one provider is connected, the main workspace should emphasize only Bark pad, chunk pipeline, and preview.
- Connected providers can be switched from a thin segmented chip control with an obvious active state.
- Users can add another provider later through a modal that reuses the initial setup flow.
- Re-entry should skip setup when at least one previously successful provider is still available.
- Claude API stays available, and Claude Code CLI is added as a separate provider.
- Provider configuration should persist to `helper/.env.local`, and the helper should auto-load it on startup.
- Local development should support a single command to start frontend + helper together, and a single command to verify the repo.

## UX flow
### Initial entry
1. App boots into `SetupGate`.
2. User sees a provider picker on the left and the selected provider form on the right.
3. User enters API key or CLI command/model hint as needed.
4. Clicking `Validate & Enter` calls helper validation.
5. On success, provider config is persisted and the app transitions to `WorkspaceShell`.

### Failure path
- Validation failure displays a single clear inline failure reason for the chosen provider.
- After acknowledging failure, the user returns to the provider picker instead of staying inside a global red state dashboard.

### Main workspace
- The main workspace header shows connected providers as thin chips.
- The active chip has strong contrast and must be immediately readable in both light and dark mode.
- The main surface shows only three primary sections:
  - Bark pad
  - Chunk pipeline
  - Preview
- Preview gets the largest visual weight.

### Add provider later
- `Add provider` opens a modal with the same flow as the initial setup gate.
- Successful validation adds the provider to the connected provider list but does not automatically switch the active provider.

### Re-entry
- If a previous provider succeeded and still appears configured from helper metadata, the app opens directly into the workspace.
- If no usable provider is available, the app opens in setup.

## Visual design
- Use Mintlify-inspired design tokens from `DESIGN.md`.
- Light and dark mode both supported through the same structural layout.
- Light mode should use visible green accenting for labels, active controls, progress emphasis, and setup CTA states.
- Dark mode should invert tokens cleanly rather than redesign layout.
- In light mode, summary/body text must remain dark enough to read comfortably.
- In light mode, active provider chips should not use white text on a light-green background; use near-black text on green.

## State model
### Top-level view states
- `setup`
- `workspace`
- `add-provider-modal`

### Setup substates
- `idle`
- `editing`
- `validating`
- `error`
- `success`

### Persistence
- `helper/.env.local` stores runtime provider config and helper bind settings.
- Frontend local storage stores UX metadata only:
  - connected provider ids
  - active provider id
  - last successful provider id

## Provider model
Providers after this redesign:
- OpenAI API
- Gemini API
- Claude API
- Claude Code CLI
- Codex CLI

Behavior rules:
- Active provider affects only future queued jobs.
- Existing jobs keep the provider they were created with.
- API and CLI variants for the same vendor are separate choices.

## Implementation structure
### Frontend components
- `SetupGate`
- `SetupProviderList`
- `SetupProviderForm`
- `WorkspaceShell`
- `ProviderSwitcher`
- `AddProviderModal`
- `BarkPadPanel`
- `ChunkPipelinePanel`
- `PreviewPanel`

### Helper responsibilities
- Load `helper/.env.local` automatically.
- Persist validated provider configuration back into `helper/.env.local`.
- Validate and dispatch all providers through the helper only.
- Keep CLI execution helper-side only.

### Local dev workflow
- `npm run dev` at repo root starts frontend and helper together.
- `Ctrl+C` should stop both.
- `npm run verify` at repo root runs the frontend, helper, and contract checks.

## Risks
- Setup-to-workspace state split could regress current queue/preview behavior if not isolated cleanly.
- Persisting provider config needs careful scope so browser UX metadata does not leak secrets.
- CLI provider additions must keep command inputs allowlisted and helper-only.

## Out of scope
- Server persistence or multi-user state.
- Mobile-specific layout work.
- Replacing the helper transport model with a hosted backend.

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


## Approved extension — live response and backlog
- Remove the `Latest summary` footer from the preview card.
- Add a provider response rail that shows the full raw provider text for the current or most recent job.
- Present the response with a typing/stream-style animation for “watching” and “waiting” value.
- Show provider + job phase status beside the preview title (for example: request in flight, waiting for response, processing, completed, next request queued).
- Keep the queue focused on active work only.
- Move completed or failed jobs into a persistent local backlog.
- Show only the 5 most recent backlog entries in the main workspace.
- Open the full backlog in a modal with 10-item pagination.
- Persist backlog locally in helper-owned storage rather than browser-only state.

## Approved redesign direction — lovable/cursor style diff-first builder
- The core loop remains `bark pad -> enqueue -> make diff -> apply -> complete program`.
- The product is **not** a generic AI SaaS; it remains a dog-usable `vibe-barking` builder.
- The right side should be dominated by a large live demo surface (roughly 70% width), similar to lovable/cursor preview-heavy layouts.
- The left side should be stacked into three zones: progress/thinking stream, compact queue summary, bark pad.
- The visual shell should feel like a **continuous dark work rail + dominant preview canvas**, not a dashboard of separate white cards.
- The progress stream must combine:
  - structured stage labels (`암호문 해석 중`, `작업 중`, `적용 중`, `적용 완료`)
  - the provider's raw reasoning/output stream while work is in progress.
- Waiting must feel active: users should be able to tell both **that work is ongoing** and **what the model is currently doing**.
- Builder updates should be diff-oriented against the current app state, not full-regeneration oriented.
- The provider contract should prefer `patch` output and only fall back to full snapshot output when patching is not viable.
- Each bark ciphertext should be interpreted as the **next small implementation step**, not the entire application specification.
- Prompt framing should explicitly instruct the model to preserve prior progress and propose/apply one coherent small change at a time.
- Queue entries should represent incremental diff tasks; completed tasks should contribute to the evolving app state shown in the live demo.


## Approved extension — progress visibility model
- The left rail should combine **structured stage labels** and **raw reasoning stream** together, not one or the other.
- Minimum visible stages:
  - `암호문 해석 중`
  - `작업 중`
  - `적용 중`
  - `적용 완료`
- During `작업 중`, the UI should stream the provider's raw reasoning / worklog text so users can tell the system is genuinely active.
- The product goal is not vague waiting; users should always be able to answer both:
  - `Is it really working right now?`
  - `What is it doing right now?`
- The right side remains a large live demo (roughly 70% width) so users see the evolving app immediately.

## Approved extension — reasoning retention policy
- Raw reasoning text should be shown in real time only.
- Persistent backlog should **not** store the full raw reasoning transcript.
- Backlog should store only compact structured progress artifacts, such as:
  - stage timeline
  - patch/apply summary
  - final output summary
  - terminal success/failure state
- This preserves the fun of live waiting without turning long-lived history into noisy transcript storage.

## Implemented shell adjustments
- The left rail is a continuous dark builder sidebar with:
  - provider controls
  - structured thinking stream
  - compact queue summary
  - bark composer
- The right side uses a preview shell with lightweight chrome above the iframe so the live demo reads like an app canvas.
- Active preview shell copy should reflect the **current job context** instead of generic placeholder labels.
- During active jobs, stale backlog preview content must not override the current-session shell state.
- Bark input must preserve IME composition flows so multilingual input (including Korean) works.

# AGENTS.md — ConsensFlow CC

Claude Code-native ConsensFlow package: a Claude Code **plugin** (skill + slash command + hooks + a Node CLI) for routing a natural-language prompt to one named participant at a time. Sibling of `../consensflow-pi` — same core, different host glue. Do not reintroduce the old ACP/live-shared-transcript architecture.

## Core direction

- The current Claude Code session is the lead/spec creator/implementer.
- ConsensFlow is a lightweight prompt router, not a shared room.
- Named participants are ephemeral one-shot subagent calls (no memory between calls).
- Each call's packet embeds a serialized, capped handoff of the current session plus the prompt; participants stay isolated one-shot subprocesses — no live/shared transcript, no ACP.
- Participant config is global/user-level and **shared across both host tools** at `~/.consensflow/participants.json` — define a participant once and use it from pi *and* cc. There are no per-tool config roots; run artifacts and the Claude Code session stash also live under `~/.consensflow/workspaces/…`.
- Participants come from curated presets (`lib/presets.js`, renameable via `--name`) or fully custom definitions (`cf participants add --name … --kind … --model … --tools …`).
- Workspace state (run artifacts plus the hook-maintained `session.json` stash) is stored per workspace under the config home (`~/.consensflow/workspaces/<dir>-<hash>/`); ConsensFlow never creates a directory inside the project.
- No hidden workflows: no spec-review command, no council/fan-out, no grill.

## Source layout

- `bin/cf.mjs` — the CLI the lead drives via the Bash tool: `status` / `doctor` / `participants …` / `run @name …`. Owns run orchestration (handoff, answer-only run output with failure/empty-handoff/write-capable diagnostics) and the image-participant path (`runImageParticipant`: prompt-only, Codex backend, PNG artifact) — the CC analog of pi's `index.ts` glue.
- `lib/*.js` — plain JS, the unit-tested core:
  - `presets.js` — preset catalog + `participantFromPreset` (pi's catalog 1:1, pygmalion included). Delta vs pi: printed guidance promotes the host slash commands (`/consensflow:participants …`), not pi's `/cf …`.
  - `state.js` — single shared ConsensFlow home (`configHome()` / `configRoot()` = `~/.consensflow`) + `participants.json` + one-time migration from old per-tool rosters when the shared file is missing + `normalizeParticipant` + workspace artifacts/session stash under `workspaces/` (`loadSession`/`saveSession`).
  - `packets.js` — `createPacket` (conversational, mode-aware, handoff + prompt).
  - `transcript.js` — Claude Code transcript JSONL → handoff text (defensive parse, sidechain/meta/noise skip, thinking redaction, ConsensFlow-run tool results kept near-whole for cross-pollination, byte-capped keep-tail). Replaces pi's `handoff.js`.
  - `workflows.js` — `effectiveToolsPolicy` (default safe mode, internally `readonly`) + `participantForKind(participant, kind, overridePolicy)` (the per-call `--rw`/`--tools` override) + `runNamedParticipant`. Verbatim from pi (parity-locked).
  - `runners.js` — per-engine invocation + output normalization + spawn/timeout, plus incremental `onStdoutLine` streaming (carry-buffer + EOF flush), the event-trail build, `surfaceOutput` (timeout → bounded trail, never raw JSONL), and the `transcript.md` backstop writer. claude-code runs `--output-format stream-json` (complete content blocks, no `--include-partial-messages`). **Mirrored with pi, not byte-identical** — documented deltas: `CHILD_ENV` (`CONSENSFLOW_CHILD=1`) on every child, `--bare` on claude children, image-kind backstop throw. Shared edits are applied to both by hand.
  - `transcript-events.js` — normalized cross-engine event model (`thinking|tool_call|tool_result|text|final`) + per-engine adapters (opencode/codex/pi/claude-code) + `adaptLine`/`renderEvent`/`renderTrail`/`surfaceOutput` + bounded trail (`MAX_EVENTS`/`MAX_EVENT_CHARS`). **Parity-locked: byte-identical with pi** (enforced by the parity test).
  - `image.js` — `image`-kind generation: Codex Responses backend → gpt-image-2 (HTTP/SSE) + base64→PNG save. Ported from pi; pure helpers unit-tested.
  - `codex-auth.js` — reads `${CODEX_HOME|~/.codex}/auth.json` for the ChatGPT access token + account id (the CC analog of pi's `ctx.modelRegistry` openai-codex token). Read-only; refresh stays the codex CLI's job.
  - `utils.js` — tokenize/slugify/path-validation helpers (`resolveInside` is realpath-checked). Verbatim from pi.
- `scripts/` — hook entrypoints: `session-start-hook.mjs` (stash transcript path + roster context), `user-prompt-hook.mjs` (stash + route a single configured `@mention` into an injected run instruction), `hook-io.mjs` (stdin reader). Both bail under `CONSENSFLOW_CHILD` and always exit 0.
- `hooks/hooks.json` — wires both hooks via `${CLAUDE_PLUGIN_ROOT}`.
- `skills/consensflow/SKILL.md` — when/how the lead consults; home of the consent gate.
- `commands/` — `/consensflow:cf` (the generic router) plus user-only admin shortcuts `/consensflow:status|doctor|presets` and `/consensflow:participants […]` (forwards its arguments to `participants …`, so `add`/`show`/`remove` work from the slash command); all delegate to the CLI. User-facing guidance printed by the CLI promotes these slash commands.
- `.claude-plugin/plugin.json` — manifest (name `consensflow`).
- `tests/core.test.mjs` (ported lib suite + preset×runner matrix), `tests/cc.test.mjs` (transcript, hooks, fake-engine e2e for all four engines, packaging locks).

## Commands & verify

```bash
npm test                                   # node --test tests/*.test.mjs
npm run check                              # alias
claude plugin validate .                   # plugin layout check
claude --plugin-dir .                      # load for a manual session (real engines bill!)
```

## Conventions

- Zero runtime dependencies; Node stdlib only. Keep all logic in `lib/*.js` testable; `bin`/`scripts` stay thin.
- Build the handoff with a hard byte cap (keep the tail). The transcript format is undocumented — parse defensively, never throw, degrade to an empty handoff.
- Cross-pollination: a participant's reply enters the transcript as the Bash tool result of its `cf.mjs run` invocation; `transcript.js` recognizes those (`CF_RUN_COMMAND`) and keeps them near-whole so later participants see earlier answers.
- Custom participant creation is supported; model/effort strings pass through to the engine verbatim. Validation lives in `normalizeParticipant` (state.js).
- Send to one participant at a time; reject multiple leading mentions.
- Participants respond to the user's prompt as written; no injected ceremony terms.
- Participants run with their configured tools; `effectiveToolsPolicy` treats a missing policy as `readonly` (write access requires an explicit `workspace-write`/`full-auto`). Per-engine enforcement: codex `--sandbox read-only` (OS-level), claude `--allowedTools` + `--disallowedTools` deny list, pi `--tools` allowlist, opencode `OPENCODE_PERMISSION={"edit":"deny","bash":"deny"}`. Claude/codex children get `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` stripped (subscription-login billing guard).
- **Streaming observability (primary):** `cf run @name --stream` renders normalized thinking / tool-call / answer events (via `renderEvent`) to stdout as they arrive — **foreground-incremental**, so the lead relays them into the session (a backgrounded run surfaces on completion). Without `--stream`, the run prints just the clean final answer. Every text-CLI run also writes a human-readable `transcript.md` (the event trail) into its run dir as a **durability backstop** — the only record that survives a killed/backgrounded run — and `result.transcriptPath` points to it. On timeout/no-answer the output is the bounded trail under a clear header, never the raw JSONL stream and never a bare whitespace fragment. `--stream`/`--rw`/`--tools`/`--json` are flags-after-prompt (parseOptions consumes a flag's next token).
- **Per-call tools override:** `--rw` (= `workspace-write`) or `--tools workspace-write|full-auto` makes a default-mode participant write-capable for one run without a second roster entry. The stored policy is the default; write stays explicit (call-time, not config-time); the consent gate is unchanged.
- Recursion guards: every child carries `CONSENSFLOW_CHILD=1`; hooks and `cf run` bail under it; claude children run `--bare`; pi children run `--no-extensions`.
- Image participants (`kind: image`) bypass the CLI runner: handled in `cf.mjs` (`runImageParticipant`) with the prompt only (no packet/handoff), auth from `codex-auth.js`, PNG + result.json under the run dir. `buildRunnerInvocation` throws on `image` as a loud backstop so it can never silently reach the CLI path. `cf doctor` reports the codex login when image participants exist.
- Consent gate: consulting is free and proactive; acting on a participant's response — or keeping a write-capable participant's edits — requires explicit user approval unless pre-authorized. Synced across `skills/consensflow/SKILL.md`, `commands/cf.md`, and both hook context strings; don't weaken one without the others (tests lock the phrases). The CLI's run output deliberately carries no consent text — it is relayed verbatim to the user.
- Keep command paths real end-to-end; no reachable stubs. Tests must never spawn live agent CLIs (PATH shims + temp `CONSENSFLOW_HOME` only).

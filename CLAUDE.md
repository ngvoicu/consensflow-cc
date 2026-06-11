# CLAUDE.md — ConsensFlow CC

Guidance for Claude Code working in this directory.

## What it is

A **Claude Code plugin** that routes one natural-language prompt to one named participant at a time — the Claude Code-native sibling of `../consensflow-pi` (same architecture, presets, and policies; different host glue; per-tool rosters under the shared `~/.consensflow` home). The participant runs as an isolated child coding-agent subprocess (`claude` / `codex` / `opencode` / `pi`) — or, for `image` kind, a Codex-backend HTTP call — gets a packet (identity + mode + a handoff of the current session + the prompt), and returns an answer the lead relays.

- **How it works, end to end:** `README.md` (flow, install, runner table, safety model, pi-vs-cc differences).
- **Conventions, source map, invariants:** `AGENTS.md`. Read it before changing code.

## Working here

- **Zero dependencies.** Plain Node (ESM). No `node_modules`, no build step.
- Test and validate:
  ```bash
  npm test                                          # node --test tests/*.test.mjs
  claude plugin validate .                          # manifest/layout check
  for f in lib/*.js bin/cf.mjs scripts/*.mjs; do node --check "$f"; done
  ```
- **Never invoke live agent CLIs from tests** — the e2e suite uses PATH-shimmed fake `claude`/`codex`/`pi`/`opencode` binaries in temp dirs, with `CONSENSFLOW_HOME` pointed at a temp home.
- Load for manual testing with `claude --plugin-dir .` in a scratch directory (a real run bills real engines).

## Load-bearing facts (easy to get wrong)

- **The session transcript JSONL is internal/undocumented.** `lib/transcript.js` parses it defensively (skip unknown types, never throw) and `collectHandoff` degrades to `""` — a handoff is context, never a precondition. Hooks stash `transcript_path` into `.consensflow/session.json` because Bash subprocesses get no session env from the host.
- **`CONSENSFLOW_CHILD=1` is the nesting guard.** Every engine child gets it (`CHILD_ENV` in runners.js); both hook scripts and `cf run` bail when it's set. `claude` children additionally run `--bare` so they don't load this plugin (the CC analog of pi children's `--no-extensions`).
- **Advisory roles (`reviewer`/`council`/`knowledge`) are forced read-only** by `effectiveToolsPolicy`; write flags must never reach them. Enforcement is per engine in runners.js (codex sandbox, claude allow+deny lists, pi tools allowlist, `OPENCODE_PERMISSION` env).
- **Per-tool config root:** `configRoot()` is `~/.consensflow/consensflow-cc` (CONSENSFLOW_HOME overrides the *parent* home; pi uses `…/consensflow-pi`). Same participants.json format in both — entries are copyable across tools.
- **Image participants run via the Codex CLI login, not a CLI runner.** `cf.mjs` handles `kind: "image"` upstream (prompt-only, no packet/handoff): `lib/codex-auth.js` reads `${CODEX_HOME|~/.codex}/auth.json` for the ChatGPT access token (refresh stays codex's job — a 401 tells the user to run `codex login`), `lib/image.js` hits the Codex Responses backend (gpt-image-2) and saves a PNG under the run dir. `buildRunnerInvocation` keeps a loud backstop throw for image kind. Do not drop "image" from `PARTICIPANT_KINDS`.
- Any subprocess `--cwd` must validate as nested inside the workspace before spawning (`resolveInside`).
- **Consent gate:** the lead consults participants freely, but never acts on a participant's response or keeps a write-capable participant's edits without user approval (unless pre-authorized). It lives in `skills/consensflow/SKILL.md`, `commands/cf.md`, the user-prompt hook's injected context, and the session-start context line — keep them in sync, and keep the wording aligned with consensflow-pi's gate.
- **Parity discipline:** `lib/{utils,workflows,artifacts}.js` are verbatim copies of consensflow-pi's, and the preset catalogs match 1:1 (pygmalion included); `presets.js`/`state.js`/`packets.js`/`runners.js`/`image.js` differ only in documented deltas (per-tool config root; session stash helpers; neutral lead wording; `--bare` + `CHILD_ENV`; codex-CLI-login image auth instead of Pi's modelRegistry). When changing shared behavior, change both projects or note the divergence in both AGENTS.md files.

## Audience

Solo-use today (single user). Keep it clean enough to externalize cheaply, but skip distribution infra until there's a real second user.

## Knowledge base

Read/write the **ngvoicu-sme** brain via the `/kluris-ngvoicu-sme` skill (never edit brain files by hand). Kluris is never bundled — degrade gracefully when it's absent.

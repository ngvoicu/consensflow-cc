---
name: consensflow
description: Use ConsensFlow inside Claude Code to consult one named participant (an external coding-agent CLI, run one-shot) for second opinions, design/code critique, questions, implementation help, or write-capable task execution. Activate whenever the user asks a named agent for input (e.g. "@zeus what do you think") OR whenever the lead itself should reach for an advisor/helper. Consulting is free and encouraged; acting on a participant's response or keeping its file changes is gated behind explicit user approval unless the user already authorized it.
---

# ConsensFlow

ConsensFlow lets the lead (this Claude Code session) consult one named participant at a time. A participant is an external coding-agent CLI (claude / codex / opencode / pi) run as an isolated one-shot subprocess: it receives a handoff of the current session plus a prompt, answers once, and does not persist between calls. Talking to a participant is like phoning an advisor/helper — and, when explicitly made write-capable, briefly handing over a task. The lead stays the decision-maker and ConsensFlow never accepts or keeps participant work on its own.

## What participants can do

Use participants for all of these, one participant at a time. No preset is intrinsically review-only; the same participant can advise in safe mode or do workspace work when made write-capable:

- **Advice / second opinion / design critique.** Ask a participant to inspect context, critique a plan, assess a pasted diff, identify risks, or suggest tests.
- **Doing work / code-writing help.** The same participant can implement, refactor, or run commands when it is write-capable (`--rw`, `--tools workspace-write`, `--tools full-auto`, or a stored write-capable roster entry). Treat it like a temporary helper: after the run, inspect `git status` / `git diff` and relevant tests, then ask the user before keeping or building on the changes unless they pre-authorized it.
- **Image generation.** `@pygmalion` (or any `kind=image` participant) uses **gpt-image-2** via the Codex backend / Codex CLI login. It receives the image prompt only — no session handoff — saves `image.png` in the ConsensFlow run dir under `~/.consensflow/workspaces/…`, and the lead can open/show that file with the Read tool. Optionally pass one or more **reference images** with `--image <path>` (repeatable) so gpt-image-2 edits/conditions on them — supply a file path (.png/.jpg/.jpeg/.webp/.gif); a pasted image with no path on disk can't be used.

## How to run it

Everything the Claude Code lead does goes through the bundled CLI via the Bash tool. Use a generous Bash timeout for frontier models (often `600000` ms or more).

```bash
# Ask one participant (default safe mode: no write tools) and stream its trail in the foreground
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" run @zeus "What's the riskiest part of this design?" --stream

# Add a focused brief on top of the automatic session handoff
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" run @zeus "Review the auth flow" --context "Focus on rollback and token expiry"

# Use a prompt file when the hook stashes a user @mention, or when the prompt is large
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" run @zeus --prompt-file question.md

# Stream normalized thinking / tool / answer events live; the parsed final answer is printed at the end too
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" run @zeus "Review this diff" --stream

# Per-call write access: use only when explicitly needed; the approval gate still applies afterward
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" run @builder "Make the minimal fix" --rw
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" run @builder "Make the minimal fix" --tools workspace-write

# Image generation with optional reference image(s) (--image is repeatable; image participants only)
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" run @pygmalion "A watercolor of this house at sunset" --image /tmp/house.png
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" run @pygmalion "Blend these into one scene" --image a.png --image b.jpg
```

Important run flags (flags may appear before or after the prompt/ref; `--prompt-file` may stand in for the prompt):

- `--context <note>` — focused lead brief in addition to the auto-included handoff.
- `--no-handoff` — skip the session handoff.
- `--stream` — render live normalized events as the child works, then print the parsed final answer again after the child exits. **Always pass it, in the foreground, for participant runs** — never drop it, detach the run, or substitute `--json` to hide the trail. The only exception is an explicit user request for JSON output.
- `--rw` — shorthand for `--tools workspace-write` for this run only.
- `--tools workspace-write|full-auto` — per-call write override; does not mutate the roster.
- `--timeout-ms <ms>` — per-call timeout override.
- `--image <path>` — reference image for an `image` participant; repeatable for multiple references. Ignored by text participants.
- `--json` — print full run metadata instead of just the human answer.

The handoff (a serialized snapshot of this session) is attached automatically from the transcript stash the plugin hooks maintain. If no transcript was stashed, the run warns `Handoff: empty` — the participant saw none of this session.

Artifacts land in the workspace's run dir under `~/.consensflow/workspaces/…` (`packet.md`, `stdout.txt`, `stderr.txt`, `result.json`, `transcript.md`) — never inside the project. `packet.md` is byte-for-byte what the participant received; `transcript.md` is the durable event-trail backstop.

## The two rules that matter most

These two rules are the heart of the skill. They pull in opposite directions on purpose: consulting is cheap and encouraged; acting on the result is gated.

### 1. Consulting is free — and encouraged

The lead may, and should, reach for a participant on its own initiative, with NO user permission needed merely to consult. Treat a participant consultation as a natural reflex, not a rare ceremony — before finalizing a non-trivial design or diff, consider getting another take. Just run the CLI; you do not ask the user "may I consult X?" first. Good moments, with the kind of prompt to send:

- **Before finalizing a non-trivial design or diff** — `@zeus` "Review this approach; call out the riskiest assumption and anything you'd do differently."
- **To stress-test a plan** — `@athena` "Poke holes in this migration plan — what breaks under load or on rollback?"
- **To surface unknowns before building** — `@iris` "What questions should I answer before I start implementing this?"
- **For a quick gut-check or tie-breaker** — `@luna` "Does this error handling read as correct to you — yes/no with one reason?"
- **For a focused diff/task check** — run `git diff` yourself and paste the relevant parts into the prompt or `--context` brief.

### 2. Acting on the output is GATED — never without asking

The lead MUST NOT apply, merge, commit, adopt, integrate, or otherwise act on a participant's response — and MUST NOT keep or extend any files a write-capable participant edited — without first surfacing it to the user and getting explicit approval. This is a hard rule, not a preference.

Before acting, the lead MUST present:

- a concise **summary** of what the participant said or did, and
- the **lead's own recommendation** (accept / accept-with-changes / reject, and why).

Then wait for the user to approve.

This gate covers BOTH cases equally:

- **(a) Advice in a text response.** Do not implement, refactor toward, or commit to a participant's suggestion until the user approves it.
- **(b) Real changes by a write-capable participant.** A `workspace-write` / `full-auto` participant may have edited files or run commands in the workspace. Do not treat that work as accepted: inspect what changed yourself (for example `git status` / `git diff` in the relevant repo), then surface a summary + recommendation and get approval before keeping, building on, or committing it. If the user rejects it, revert it.

**The only exception:** the user has already explicitly told the lead to proceed — e.g. "get Zeus's take and apply what makes sense," or "run the builder and commit it." Pre-authorization scoped to that request stands in for the approval; do not re-ask. Absent such an instruction, never act on a participant's output on your own.

Do / Never, in one line each:

- **Do** consult a participant whenever a second opinion would help — no permission needed.
- **Never** apply, commit, or keep a participant's advice or file changes without the user's go-ahead, unless the user pre-authorized it.

In short: ask freely, apply only with a green light.

## How participants are created

Participants are configured in the shared roster `~/.consensflow/participants.json` (set up once, use from any project, Claude Code, and the Pi sibling). There are no per-tool config roots. Participants come from curated presets or fully custom definitions:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants presets                    # list built-in presets
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants add zeus                   # add a preset → @zeus
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants add daedalus               # Pi-backed Kimi K2.7 Code → @daedalus
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants add all                    # add every preset
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants add zeus --name Deepreview # preset backend, renamed → @deepreview
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants add --name Builder --kind codex --model gpt-5.5 --effort high --tools workspace-write   # fully custom, write-capable by default
```

Presets use default safe mode; the same model+effort family exists on every engine that runs it:

- **Fable 5** (Anthropic's top model — use for the questions that really matter): `@calliope`/`@clio`/`@euterpe`/`@thalia` (Claude Code max/xhigh/high/medium), `@orpheus`/`@linus`/`@erato` (Pi xhigh/high/medium, Anthropic auth), `@saga`/`@gunnlod`/`@kvasir` (OpenCode xhigh/high/medium via OpenRouter).
- **Opus 4.8**: `@zeus`/`@apollo`/`@artemis` (Claude Code max/xhigh/medium), `@kronos`/`@atlas` (Pi xhigh/medium, Anthropic auth), `@baldr`/`@vali` (OpenCode xhigh/medium via OpenRouter; xhigh is the ceiling outside claude-code).
- **GPT 5.5**: `@athena`/`@perseus`/`@loki` (Codex xhigh/high/medium), `@iris`/`@hermes`/`@eos` (Pi xhigh/high/medium), `@forseti`/`@bragi`/`@ullr` (OpenCode xhigh/high/medium via OpenRouter).
- **Deep open-weights**: Kimi K2.7 Code — `@luna` (OpenCode), `@daedalus` (Pi craftsman preset), `@selene` (Pi moon-goddess alias; both Pi presets use high thinking).
- **Fast/cheap tier** (quick gut-checks): `@hermod` (Claude Haiku 4.5), `@nike`/`@sif` (Gemini 3.5 Flash on Pi/OpenCode), `@zephyros`/`@freya` (DeepSeek V4 Flash on Pi/OpenCode).
- **Model zoo** (same OpenRouter models on two engines; Greek = pi, Norse = opencode): DeepSeek V4 Pro `@hades`/`@odin`, Gemini 3.1 Pro `@helios`/`@heimdall`, Grok 4.3 `@ares`/`@thor`, Qwen3.7 Max `@hephaestus`/`@tyr`, Llama 4 Maverick `@pan`/`@vidar`, Mistral Large `@aeolus`/`@njord`, MiniMax M3 `@metis`/`@mimir`, GLM 5.2 `@prometheus` (pi only).
- **Image**: `@pygmalion` (kind=image) generates a picture with gpt-image-2 via the Codex CLI login (`codex login`) — prompt-only (no handoff), optional `--image <path>` reference(s), PNG saved as `image.png` in the run dir; open it with the Read tool to view or show it.

Model and effort strings pass through to the engine verbatim, so any identifier the engine accepts works.

## Full command reference for the lead

Use the CLI directly from Bash:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" status
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" doctor
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants list
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants presets
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants add <preset> [--name <name>] [--cwd <subdir>] [--timeoutMs <ms>]
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants add all
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants add --name <name> --kind <pi|claude-code|codex|opencode|image> --model <model> [--effort <e>|--thinking <t>] [--tools workspace-write|full-auto] [--cwd <subdir>]
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants show @name
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants remove @name
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" run @name <prompt> [--stream] [--rw|--tools workspace-write|full-auto] [--prompt-file <file>] [--context <note>] [--no-handoff] [--timeout-ms <ms>] [--image <path> …] [--json]
```

User-facing slash commands are thin wrappers around that CLI: `/consensflow:cf`, `/consensflow:status`, `/consensflow:doctor`, `/consensflow:presets`, and `/consensflow:participants …`.

## Safe-mode vs write-capable participants

- **Default and presets:** safe mode (no write tools). They are not review-only; they can plan, critique, explain, and propose code, but they cannot edit files or run commands until made write-capable.
- **Stored write-capable participant:** create/update with `--tools workspace-write` (or `full-auto`) when the participant is meant to edit by default.
- **Per-call write access:** prefer `--rw` or `--tools workspace-write` on a single `run` when you only need one write-capable call. This keeps one roster entry and makes the escalation obvious in the command history.
- **After any write-capable run:** run your own inspection (`git status`, `git diff`, relevant tests as needed), summarize what the participant changed, give your recommendation, and wait for user approval before keeping/building on/committing the changes unless the user pre-authorized that exact action.

## How the user asks

When the user's prompt addresses one configured participant — `@zeus What's the riskiest part of this design?` — the plugin's prompt hook detects it, stashes the prompt body, and injects the exact `run` command for you to execute. Run it, then relay the answer. The `/consensflow:cf` slash command is the explicit form (`/consensflow:cf @zeus <prompt>`, `/consensflow:cf doctor`, …). A stray `@token` that is not a participant (like `@types/node`) is ignored — handle the prompt normally.

## Invariants

- **One at a time.** Send to exactly one participant per call. Never fan out to several participants automatically. If the user names several, ask which one first, or ask one and wait for its answer before asking the next.
- **Safe by default, not review-only.** A participant runs without write tools unless it was explicitly configured with `--tools workspace-write` or `full-auto`, or that call passes `--rw` / `--tools workspace-write`.
- **One-shot, no memory.** Each call is fresh. Continuity comes only from the handoff (re-sent each time), which already includes earlier participant replies — so a later participant can build on an earlier one (cross-pollination). For a genuinely *independent* opinion, ask that participant **first**, before others have replied — otherwise its handoff carries the prior answers and colors it.
- **Foreground streaming is non-optional.** Every routed participant run passes `--stream` and stays in the foreground; the lead must not background/detach it, swap it for `--json`, or summarize the streamed trail away. The one exception is an explicit user request for JSON output.
- **The lead is always the decision-maker.** ConsensFlow routes a prompt and returns an answer; it never implements anything on its own. Acting on any answer goes through the gate above.
- **No automatic git context.** Participants receive only the handoff and the prompt — paste a diff or name the files when you want them assessed or changed.
- **No hidden workflows.** Do not assume ceremonies like spec review, implementation review, council, grill, or handoff-by-name. The skill routes one prompt to one participant; that is all.
- **No nesting.** Participant subprocesses run with `CONSENSFLOW_CHILD=1` and must not start their own ConsensFlow runs.

# ConsensFlow CC

Ask other AI coding agents — **Claude Code, Codex, Pi, OpenCode** — for a second opinion, **one at a time, by name**, without leaving your Claude Code session.

This is the Claude Code-native sibling of [consensflow-pi](../consensflow-pi/): same presets, same packet/runner core, same safety model, same config format — packaged as a **Claude Code plugin** instead of a Pi extension. Both tools share one participant roster at `~/.consensflow/participants.json`, so a participant defined in either is available in the other.

---

## What is it? (the 30-second version)

You're coding with **Claude Code**, your main AI assistant. Sometimes you want another model's take — maybe Codex to sanity-check a diff, a second Claude at max effort for architecture, or a cheap fast model for a quick gut-check.

ConsensFlow lets you keep a roster of **participants**. A participant is just *one specific AI agent + model* that you've set up and given a name — like `@zeus` or `@athena`. When you want one's opinion, you `@mention` it right in your Claude Code prompt. ConsensFlow then:

1. packages a snapshot of your current conversation (the **handoff**) plus your question,
2. runs that agent in an isolated subprocess as a **one-shot** (your session stays usable),
3. and shows you its answer.

The whole idea in five bullets:

- **Participant** = a named *(agent + model)* combo. Configure once, reuse from any project. The roster is **shared across both tools** at `~/.consensflow/participants.json` — set it up once, use it from pi and cc.
- **One at a time.** `@zeus @athena …` is rejected — ask one, read, then ask the next.
- **Standard read-write by default.** A participant runs as a normal CLI call — exactly like running that agent yourself — so by default it can read, edit files, and run commands, confined to the project workspace (`workspace-write`). The lead still decides whether to keep its changes. `--tools full-auto` is the only escalation; it bypasses the engine's sandbox/approval checks.
- **One-shot, but context-aware.** Each call is fresh (no memory of past calls), yet it always receives the current session handoff — *including earlier participants' answers* — so the 2nd agent you ask can build on the 1st.
- **The lead can ask too — and asks before applying.** Claude Code will consult a participant on its own initiative when a second opinion would help, then report back and get your go-ahead before applying anything — unless you pre-authorized it.

## How it works — the flow

```text
You, in your Claude Code session
   │   type:  @zeus what's the riskiest part of this design?
   ▼
The plugin's UserPromptSubmit hook sees exactly one configured @mention
   │   stashes the prompt body and injects the exact run command as context
   ▼
Claude (the lead) executes via the Bash tool:
   node ".../bin/cf.mjs" run @zeus --prompt-file "~/.consensflow/workspaces/<ws>/pending-prompt.md"
   ▼
cf.mjs builds a "packet" for @zeus:
   • who @zeus is        (claude-code · claude-opus-4-8 · max)
   • mode line           (workspace-write by default — or full-auto if you escalated)
   • handoff             (a snapshot of THIS session, from the transcript stash the hooks maintain)
   • your question
   ▼
Runs @zeus as an isolated, one-shot subprocess (default workspace-write, no session persistence)
   ▼
Saves artifacts:  ~/.consensflow/workspaces/<ws>/runs/<run-id>/{packet.md, stdout.txt, stderr.txt, result.json}
   ▼
Claude relays @zeus's answer — and never acts on it without your approval
```

## Install

**Prerequisites:** Node.js, plus the CLI for each engine you want to use on your `PATH`:

| Engine | CLI |
|---|---|
| Claude Code | `claude` (already there) |
| Codex | `codex` |
| OpenCode | `opencode` |
| Pi | `pi` |

**Install from GitHub** (this repo is its own plugin marketplace):

```bash
claude plugin marketplace add ngvoicu/consensflow-cc
claude plugin install consensflow@consensflow-cc
```

Get newer versions later with `claude plugin marketplace update consensflow-cc`; uninstall with `claude plugin uninstall consensflow`.

**Or load from a local clone** (for development — edits picked up on next start):

```bash
claude --plugin-dir /path/to/consensflow-cc

# Validate the plugin layout any time:
claude plugin validate /path/to/consensflow-cc
```

**Verify** inside a session: `/consensflow:doctor` shows which engine CLIs are installed; `/consensflow:status` shows your participants.

## How to use

### Step 1 — Configure participants

Same presets as consensflow-pi (49 curated presets — every model+effort family on every engine that runs it, including the `@pygmalion` image preset; `/consensflow:presets` prints the full list):

```text
/consensflow:presets                         # see all presets
/consensflow:participants add zeus           # add one        → @zeus
/consensflow:participants add daedalus       # Pi-backed Kimi K2.7 Code → @daedalus
/consensflow:participants add all            # add everything
/consensflow:participants add zeus --name Deepreview   # renamed copy
```

Or fully custom (any model string the engine accepts — values pass through verbatim):

```text
/consensflow:participants add --name Sonnet --kind claude-code --model claude-sonnet-4-6 --effort high
/consensflow:participants add --name Builder --kind opencode --model openrouter/moonshotai/kimi-k2.7-code --tools workspace-write
```

> **Default vs full-auto.** By default a participant runs read-write, confined to the project workspace (`workspace-write`) — it can read, plan, critique, edit files, and run commands, just like running the agent yourself. To remove that confinement and bypass the engine's sandbox/approval checks, pass `--tools full-auto` when creating it, or use it on a single run.

Config lives in the **shared** roster `~/.consensflow/participants.json` — used by both consensflow-cc and consensflow-pi, so a participant added in one is immediately available in the other. There are no per-tool config roots. If this shared file is missing but an older per-tool roster exists at `~/.consensflow/consensflow-cc/participants.json` or `~/.consensflow/consensflow-pi/participants.json`, ConsensFlow migrates those entries into the shared file once.

### Step 2 — Ask

```text
@zeus What's the riskiest part of this design?        # plain prompt — the hook routes it
/consensflow:cf @zeus What's the riskiest part?       # explicit slash command
```

Admin shortcuts: `/consensflow:status`, `/consensflow:doctor`, `/consensflow:presets`, and `/consensflow:participants` (no arguments lists what you've added; it also takes `add` / `show` / `remove` arguments, e.g. `/consensflow:participants add athena`) — each just runs the matching CLI subcommand.

Claude itself can also consult participants on its own initiative (the bundled skill encourages it before finalizing non-trivial designs/diffs) — consulting is free, **acting on the answer always needs your approval** unless you pre-authorized it.

Participants don't get your git state automatically — when you want a diff reviewed, paste the relevant parts into the prompt (or Claude includes them via `--context` when it consults on its own).

### Step 3 — Read the answer (and where it's saved)

The answer is relayed inline. Every run is saved under the ConsensFlow home — never inside your project:

```text
~/.consensflow/workspaces/<workspace>-<hash>/runs/<run-id>/
  packet.md      # exactly what the participant was sent
  stdout.txt     # raw engine output
  stderr.txt     # raw engine errors/progress
  result.json    # parsed answer + metadata (incl. transcriptPath)
  transcript.md  # human-readable thinking / tool calls / answer — the durability backstop
```

**Watch it work live:** routed `@name` prompts and explicit `/consensflow:cf` participant runs always run in the foreground, and the participant's thinking, tool calls, and answer render to stdout as they arrive — the live reasoning/tool/answer trail streams automatically (no flag needed). Always run participant calls in the FOREGROUND, NEVER in the background or detached; this is non-optional — the lead must not detach the run or summarize the trail away (the one exception is an explicit user request for `--json` machine output). If you invoke the CLI manually (`cf run @name <prompt>`), keep the run in the foreground; streaming is on by default either way. The parsed final answer is always printed after the child exits too, so runs end with a durable reply section, and every run writes `transcript.md` as a durability backstop. If a run ends without a final answer you get the bounded trail under a clear header — never a raw event dump. cf never caps a run — runs are unbounded; the only limit is the lead's Bash tool timeout.

Since a consult can modify files, review what changed yourself (e.g. `git status` / `git diff` in your repo) before keeping it — the lead decides whether to keep or build on a participant's changes. **Per-call escalation:** add `--tools full-auto` to lift the workspace confinement on only that run — no second roster entry needed.

### The handoff — what a participant actually sees

Every run (unless you pass `--no-handoff`) embeds a **handoff**: a one-shot snapshot of your current Claude Code session, built fresh at call time. Knowing what's in it tells you when to trust it and when to restate context yourself.

```text
Your live Claude Code session
   │  the plugin hooks stash the session's transcript path per workspace
   │  (Bash subprocesses get no session env from the host — the stash is the bridge)
   ▼
cf.mjs parses the transcript JSONL at call time: "User: … / Lead: …" turns,
tool calls noted, thinking redacted, sidechains/noise skipped,
earlier participants' answers kept near-whole
   ▼
capped at 48 KB by default (CONSENSFLOW_HANDOFF_MAX_BYTES) — keeps the MOST RECENT tail,
older history drops off behind a truncation marker
   ▼
embedded in the packet, between the mode line and your question
```

What that means in practice:

- **It's a rendering, not the raw context.** The participant gets readable conversation text, never your model's actual context window — so a 1M-token lead session can never overflow a 200k participant.
- **Short and medium sessions hand off essentially everything.** Only when the serialized text outgrows the cap (48 KB by default, tunable via `CONSENSFLOW_HANDOFF_MAX_BYTES`) does the oldest part fall away; a very long session hands off just the recent stretch.
- **You can see what rode along.** A clean run shows just the answer; a run with no stashed transcript warns `Handoff: empty` (the hooks aren't running, e.g. plugin not loaded). `packet.md` in the run dir is byte-for-byte what the participant received.
- **A handoff is context, never a precondition.** If the stash is missing the run still works — the participant just answers from your prompt and whatever it reads in the workspace, and the `Handoff:` line tells you that's what happened.
- **Cross-pollination is deliberate.** Earlier participants' answers are kept near-whole, so `@zeus Do you agree with Athena?` works. For a genuinely independent opinion, ask that participant first.
- **When old context matters, restate it.** If a decision from early in a long session is the point of your question, put it (or the relevant diff) in the prompt or `--context` brief — don't assume it's still inside the tail.

### Images — the `@pygmalion` participant

`@pygmalion` is an **image** participant: mention it with a description and it generates a picture (gpt-image-2) instead of returning text — riding your existing **Codex CLI login** (`codex login`, ChatGPT Plus/Pro; no extra key).

```text
@pygmalion a minimalist logo for a terminal multi-agent tool — flat vector, navy + amber
```

- Takes your **prompt only** — no session handoff (an image model can't use the transcript).
- The PNG is saved as `image.png` in the run dir; Claude can open it with the Read tool.
- `cf doctor` checks the Codex login when image participants are configured; an expired token says so and points at `codex login`.
- Roll your own: `cf participants add --name <name> --kind image` (the model field is only the trigger; the backend is always gpt-image-2).

## CLI reference (`bin/cf.mjs`)

```text
cf status                        # participants + session stash + latest run
cf doctor                        # which engine CLIs are installed
cf participants presets|list|show @name|remove @name
cf participants add <preset>|all|--name … --kind … --model …
cf run @name <prompt> [--tools workspace-write|full-auto] [--prompt-file f] [--context note] [--no-handoff] [--json]
#   flags may go before or after the prompt; the live reasoning/tool/answer trail streams automatically (no flag needed)
#   runs are workspace-write by default; --tools full-auto escalates (bypasses sandbox/approval)
```

## Safety model

- **Isolated & one-shot:** each participant runs in its own subprocess, started in your workspace (a `--cwd` that escapes it is rejected before launch, realpath-checked). No memory between calls.
- **Workspace confinement by default:** participants run with the engine's `workspace-write` policy — read, edit, and run commands, but scoped to the project workspace. `--tools full-auto` is the only escalation and lifts that confinement, bypassing the engine's sandbox/approval checks; use it deliberately.
- **No recursion:** every child gets `CONSENSFLOW_CHILD=1` (hooks and the CLI bail inside it), and `claude` children run `--bare` so they don't load this plugin at all. Pi children run `--no-extensions`.
- **Billing guard:** `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` are stripped from claude/codex children so runs stay on your subscription logins.
- **You're always the lead.** ConsensFlow routes your question and shows you the answer — Claude summarizes and asks before applying anything, unless you've already told it to proceed.

## Differences vs consensflow-pi

| | consensflow-pi | consensflow-cc |
|---|---|---|
| Host | Pi extension (`pi install …`) | Claude Code plugin (`--plugin-dir` / marketplace) |
| @mention routing | input interception in the extension | `UserPromptSubmit` hook injects the run command |
| Handoff source | `ctx.sessionManager.getBranch()` | session transcript JSONL, stashed by hooks into the workspace's `session.json` under the ConsensFlow home |
| Per-participant `/name` commands | no — use `@name` or `/consensflow:cf` | no — use `@name` or `/consensflow:cf` |
| Image participants (`@pygmalion`) | yes (Pi's openai-codex login) | yes (the Codex CLI's login, `~/.codex/auth.json`) |
| Participant roster | `~/.consensflow/participants.json` (shared with cc) | `~/.consensflow/participants.json` (shared with pi) |
| Everything else (presets, packet, runners, policies, artifacts) | identical | identical |

## Develop / test

```bash
npm test                                            # node --test tests/*.test.mjs
claude plugin validate .                            # manifest/layout check
```

Tests never invoke live agent CLIs: the e2e suite runs all four engines against PATH-shimmed fake binaries in temp dirs.

# ConsensFlow

Consensus-driven multi-agent orchestration for Claude Code.

Named agents with personas and any engine/model discuss, reach consensus,
then implement. Claude is the active lead participant — it researches,
forms opinions, and can update its position after hearing agents.

## Install

```bash
claude plugin marketplace add ngvoicu/consensflow-cc
claude plugin install consensflow-cc@consensflow-cc
/consensflow-cc:setup
```

## How It Works

ConsensFlow is invisible until you address an agent by name, mention a team,
or run a slash command:

```
you: atlas, what do you think about using oslo for auth?
→ Single-agent consultation with atlas

you: atlas, athena — debate oslo vs lucia
→ Two-agent discussion with consensus

you: team, should we add caching?
→ Full-team consensus

you: forge, implement the OAuth callback
→ Delegate implementation to forge
```

## Supported Engines

| Engine | CLI | Write | Best for |
|--------|-----|-------|----------|
| Claude (native) | — | Yes | Lead, synthesis, full-context work |
| Codex | `codex exec` | Yes (`--full-auto`) | GPT-5.4 tasks, implementation |
| OpenCode | `opencode run` | Yes | Universal — all providers |
| Gemini CLI | `gemini -p` | No (headless) | Google models, quick reads |

Models are free strings. Whatever you put in the agent's `engine_model`
field is passed through to the CLI — no model registry, no deprecation
risk.

## Defining Agents

Create agent markdown files in `~/.claude/agents/` or `.claude/agents/`:

```markdown
---
name: atlas
description: CTO and lead architect. Use for architecture reviews.
tools: Read, Grep, Glob, Bash
model: opus
color: blue
consensflow:
  engine: claude
  engine_model: opus
  role: cto
  team: product-team
---

You are Atlas, CTO with 25 years in distributed systems...
```

## Defining Teams

Create team JSON in `~/.config/consensflow-cc/teams/`:

```json
{
  "name": "product-team",
  "description": "Product development team",
  "agents": ["atlas", "athena", "forge", "mira", "ares", "hermes"],
  "defaults": {
    "timeout": 120
  }
}
```

`timeout` is in **seconds** (bare numbers are treated as seconds; suffix with
`ms`, `s`, or `m` for explicit units when passing `--timeout` to the companion
script). The default invocation timeout is 180 s if none is specified.

## Commands

| Command | Purpose |
|---------|---------|
| `/consensflow-cc:setup` | Detect engines, configure |
| `/consensflow-cc:ask` | Ask one or more agents a question |
| `/consensflow-cc:delegate` | Delegate a task to an agent |
| `/consensflow-cc:review` | Multi-agent code review |
| `/consensflow-cc:team` | List/show teams |
| `/consensflow-cc:status` | Show engines, teams, recent discussions |

## Development

```bash
npm install
npm test                    # Run all tests
npm run test:coverage       # With coverage report
npm run test:watch          # Watch mode
```

85 tests passing. 87.5% line coverage.

## Architecture

```
User → SKILL.md (consensus protocol) → Claude (lead)
                                           ↓
                                 Companion script (Node.js)
                                           ↓
                          ┌────────────────┼────────────────┐
                          ↓                ↓                ↓
                       Codex           OpenCode          Gemini

Claude (native) agents skip the companion — spawned as Claude Code subagents.
```

- **SKILL.md**: the fat skill teaching Claude the consensus protocol
- **Companion**: thin Node.js script handling engine calls, state, hooks
- **Zero runtime dependencies** (only devDep: vitest)

## License

MIT

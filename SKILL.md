---
description: >
  Consensus-driven multi-agent orchestration. Named agents with personas
  and any engine/model discuss, reach consensus, then implement. Use when
  the user addresses agents by name, says "team", or runs /consensflow-cc:*
  commands.
user-invocable: false
---

# ConsensFlow — Consensus Protocol

You are the lead of a multi-agent team. When the user addresses agents by
name, mentions "team", or uses `/consensflow-cc:*` commands, you orchestrate
a consensus-driven discussion. Otherwise, you work normally — ConsensFlow
is invisible until triggered.

## When to Activate

Activate the consensus protocol when you detect ANY of these patterns:

| Pattern | Example | Mode |
|---------|---------|------|
| One agent name + question | "atlas, what do you think?" | Single-agent ask |
| One agent name + task | "forge, implement the auth" | Single-agent delegation |
| Two+ agent names | "atlas, athena — debate this" | Multi-agent discussion |
| "team" or team name | "team, should we use X?" | Full team discussion |
| "everyone" / "all agents" | "everyone, review this" | Full team |
| "everyone except X" | "everyone except forge" | Team minus exclusion |
| One agent + "review/tear apart" | "ares, tear this apart" | Single-agent review |
| `/consensflow-cc:ask` | Slash command | Explicit ask |
| `/consensflow-cc:delegate` | Slash command | Explicit delegation |
| `/consensflow-cc:review` | Slash command | Explicit multi-agent review |

Do NOT activate for normal conversation that doesn't mention agent names
or teams. The user should be able to work with you normally.

## Agents

ConsensFlow agents are defined as markdown files in `~/.claude/agents/`
or `.claude/agents/` with a `consensflow:` block in their frontmatter:

```yaml
consensflow:
  engine: codex|opencode|gemini|claude
  engine_model: <free string — passed to engine CLI as-is>
  role: <short role description>
  team: <team name>
```

To find agents, look for markdown files with `consensflow:` in frontmatter.

## Teams

Teams are JSON files in `~/.config/consensflow-cc/teams/`:
```json
{ "name": "product-team", "agents": ["atlas", "athena", "forge"] }
```

When user says "team" without a name:
- One team exists: use it
- Multiple teams: ask which one
- No teams: tell user to create one

## You Are the Lead

You are NOT a passive moderator. You are an active participant:

1. **Research first** — Read code, grep for patterns, understand context
2. **Form your position** — Think about the problem, form an opinion
3. **State your position** — Share your analysis and recommendation
4. **Listen** — Hear what agents say
5. **Update** — If an agent makes a better argument, change your mind
6. **Synthesize** — Integrate all positions including your own

Your synthesis can and should change your initial position when warranted.

## Discussion Mode (Claude Speaks First)

For discussions and questions ("should we use X?", "what's the best approach?"):

1. **Research**: Use Read, Grep, Glob to understand the codebase context
2. **Position**: State your opinion with reasoning
3. **Agent turns** (sequential): For each agent:
   a. Build a briefing with: topic + context + your position + all prior turns
   b. Invoke via companion script:
      ```bash
      node "${CLAUDE_PLUGIN_ROOT}/scripts/consensflow-companion.mjs" invoke \
        --agent <name> --engine <engine> --model <model> "<briefing>"
      ```
   c. For `claude` engine agents: spawn as a Claude Code subagent instead
   d. Present the response with attribution
4. **Synthesize**: Show who agrees/disagrees, key concerns, your updated position
5. **Recommend**: Present your recommendation, ask user to approve or discuss more

## Review Mode (Claude Speaks Last)

For reviews ("review this PR", "tear this apart"):

1. **Gather context**: Read changed files, run git diff
2. **Agent turns**: Each agent reviews independently — do NOT share your
   position or other agents' reviews in the briefing
3. **Synthesize LAST**: After all agents have reviewed, present your
   synthesis of all findings

## Delegation Mode

For implementation tasks ("forge, implement X", "atlas, fix this bug"):

1. **Context**: Read relevant code, understand the task
2. **Optional consensus**: If the task is ambiguous, quick-ask team first
3. **Delegate**: Invoke the agent with write mode:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/consensflow-companion.mjs" delegate \
     --agent <name> --engine <engine> --model <model> "<task with context>"
   ```
4. **Present result**: Show what the agent did with clear attribution
5. **Optional review**: Offer to have other agents review the changes

## Engine Capabilities

| Engine | Invocation | Write | Notes |
|--------|-----------|-------|-------|
| Claude | Native subagent | Yes | Full tools, shares session context |
| Codex | `codex exec --model M "P"` | Yes | `--full-auto` for writes |
| OpenCode | `opencode run -m M "P"` | Yes | `--dangerously-skip-permissions` |
| Gemini | `gemini -p "P" -m M -o text` | No | Headless, read-only |

Models are free strings. Whatever the user configured in the agent's
`engine_model` field, pass it through to the engine CLI. The engine
validates at runtime.

## Retry on Failure

If an engine call fails, the companion script retries once automatically.
If both attempts fail, report the failure and continue with remaining agents.
Never crash the discussion because one agent is unavailable.

## Response Attribution

Every agent response must be clearly attributed:

```
## atlas (codex / gpt-5.4)
<response>
```

The synthesis must reference agents by name and state their positions.

## Model Override

The user can override an agent's model for a single discussion:
"athena, switch to gemini-2.5-flash for this one"

Update the model in the engine invocation but do not change the agent file.

## Claude Code Plugin

Commands available via slash:
- `/consensflow-cc:setup` — detect engines, configure
- `/consensflow-cc:ask` — ask agents a question
- `/consensflow-cc:delegate` — delegate implementation to an agent
- `/consensflow-cc:review` — multi-agent code review
- `/consensflow-cc:team` — list/show teams
- `/consensflow-cc:status` — show engines, teams, recent discussions

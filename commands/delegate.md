---
description: Delegate a coding or implementation task to an agent
argument-hint: "[--agent <name>] <task description>"
allowed-tools: Bash(node:*), Read, Grep, Glob
---

Delegate an implementation task to the specified agent.

Raw user request:
$ARGUMENTS

## Execution

1. Identify the target agent from --agent flag or natural language
2. Build context: read relevant files, understand the task
3. Invoke the companion script with write mode:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/consensflow-companion.mjs" delegate --agent <name> --engine <engine> --model <model> "<task with context>"
```

4. Present the result with clear attribution

## Engine write capabilities

- **Codex**: Full write support via `--full-auto`
- **OpenCode**: Write support via `--dangerously-skip-permissions`
- **Gemini**: Read-only in headless mode — warn user if selected
- **Claude (native)**: Full write support as subagent

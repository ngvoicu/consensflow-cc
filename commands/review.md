---
description: Multi-agent code review of current changes
argument-hint: "[--agents <names>] [--team <name>] [--base <ref>]"
allowed-tools: Bash(node:*), Read, Grep, Glob
---

Run a multi-agent code review. Each agent reviews independently.

Raw user request:
$ARGUMENTS

## Execution

1. Gather diff context:
   - Run `git diff` (or `git diff --base <ref>` if specified)
   - Read changed files for full context

2. For each agent, invoke independently (REVIEW MODE — no lead position shared):
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/consensflow-companion.mjs" invoke --agent <name> --engine <engine> --model <model> "<review briefing with diff>"
```

3. Present all reviews, then synthesize (Claude speaks LAST in review mode)

## Response format

```
## <agent-name> (<engine>/<model>) — Review
<findings>

## Consensus Review
<Claude's synthesis of all reviews>
```

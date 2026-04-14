---
description: Show ConsensFlow status — engines, teams, recent discussions
argument-hint: ""
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

Show current ConsensFlow status.

## Execution

1. Check engines:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/consensflow-companion.mjs" setup
```

2. List teams:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/consensflow-companion.mjs" team list
```

3. Load recent state:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/consensflow-companion.mjs" state load
```

Present a compact summary: available engines, configured teams,
and recent discussions (if any).

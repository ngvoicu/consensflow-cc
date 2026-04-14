---
description: List and manage ConsensFlow teams
argument-hint: "[list|show] [--team <name>]"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

Manage ConsensFlow teams.

## Actions

**List teams:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/consensflow-companion.mjs" team list
```

**Show team details:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/consensflow-companion.mjs" team show --team <name>
```

Present results in a clear, formatted table showing team name,
agents, and their engine/model configurations.

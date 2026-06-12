---
description: "ConsensFlow: list the curated participant presets"
disable-model-invocation: true
---

Run the ConsensFlow CLI via the Bash tool and relay its output as-is:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants presets
```

If the user wants one configured, suggest `/consensflow:cf participants add <preset>` (or `add all`).

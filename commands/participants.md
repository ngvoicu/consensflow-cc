---
description: "ConsensFlow: list the participants you have added"
disable-model-invocation: true
---

Run the ConsensFlow CLI via the Bash tool and relay its output as-is:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants list
```

If none are configured yet, point at `/consensflow:presets` and `/consensflow:cf participants add <preset>`.

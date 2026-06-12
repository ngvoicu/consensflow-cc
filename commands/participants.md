---
description: "ConsensFlow: list the participants you have added"
disable-model-invocation: true
---

Run the ConsensFlow CLI via the Bash tool and relay its output as-is:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants list
```

If none are configured yet, relay the CLI's creation instructions as-is and add that the user can simply ask in plain words — e.g. "add the zeus preset" or "add all presets" — and you will run the matching `participants add` command for them.

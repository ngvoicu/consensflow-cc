---
description: "ConsensFlow: list or manage your participants (add, show, remove, presets)"
argument-hint: "[add <preset>|all | add --name <n> --kind <k> --model <m> … | show @name | remove @name | presets]"
disable-model-invocation: true
---

Run the ConsensFlow CLI via the Bash tool and relay its output as-is:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" participants $ARGUMENTS
```

With no arguments this lists the configured participants. Keep flags and single words as-is; shell-quote any argument containing spaces (e.g. a `--description` value).

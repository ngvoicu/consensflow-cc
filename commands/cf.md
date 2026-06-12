---
description: "ConsensFlow: manage named participants or send one prompt to one participant"
argument-hint: "status | doctor | participants <…> | @name <prompt>"
---

Run the ConsensFlow CLI with the user's arguments, via the Bash tool, and relay its output:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cf.mjs" $ARGUMENTS
```

Compose the command carefully: keep flags and single words as-is, but shell-quote any argument containing spaces or shell metacharacters. For a multi-line or quote-heavy prompt, write it to a file first and pass `--prompt-file <path>` instead of inlining it.

Notes:

- If the arguments ask a participant (`@name <prompt>` or `run @name <prompt>`), the run can take minutes — set a generous Bash timeout (600000 ms), or run it in the background and poll. Relay the participant's answer faithfully when it returns.
- After a participant answers, do not apply, commit, or keep its output — advice, or a write-capable participant's file edits — without the user's approval, unless they already authorized it.
- One participant at a time: never fan out to several participants for one request.
- For admin subcommands (`status`, `doctor`, `participants …`), just show the CLI output.
- If `$ARGUMENTS` is empty, run `status`.

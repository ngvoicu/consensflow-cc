---
description: Detect installed engines and configure ConsensFlow
argument-hint: ""
allowed-tools: Bash(node:*), AskUserQuestion
---

Run ConsensFlow setup to detect available engines.

Execute:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/consensflow-companion.mjs" setup
```

Parse the JSON output and present it as a formatted status report:
- List each engine with its availability status and version
- Claude is always available (native)
- For missing engines, suggest install commands:
  - Codex: `npm install -g @openai/codex`
  - OpenCode: `npm install -g opencode-ai`
  - Gemini: `npm install -g @google/gemini-cli`

After presenting the report, ask if the user wants to:
- Create their first agent
- View existing teams
- Skip for now

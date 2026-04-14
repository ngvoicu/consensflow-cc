---
description: Ask one or more agents for their opinion on a topic
argument-hint: "[--agent <name>] [--agents <name1,name2>] [--team <name>] <question>"
allowed-tools: Bash(node:*), Read, Grep, Glob
---

Route this request to the ConsensFlow consensus protocol.

Raw user request:
$ARGUMENTS

## Execution

1. Parse the request to identify:
   - Which agents to consult (--agent for one, --agents for multiple, --team for full team)
   - The question/topic

2. For each agent, invoke the companion script:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/consensflow-companion.mjs" invoke --agent <name> --engine <engine> --model <model> "<briefing>"
```

3. Build each agent's briefing progressively:
   - Include the topic, relevant code context, and all prior agent responses
   - For discussions: include Claude's (lead) position first
   - For reviews: do NOT include Claude's position (agents assess independently)

4. After all agents respond, synthesize positions and present consensus.

## Response format

For each agent response, clearly attribute it:
```
## <agent-name> (<engine>/<model>)
<response>
```

After all responses, present the consensus synthesis.

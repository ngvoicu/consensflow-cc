// Normalized cross-engine event model. One shape, several engine dialects behind adapters.
// Event = { kind: "thinking" | "tool_call" | "tool_result" | "text" | "final",
//           text?, tool?, args?, result? }
//
// This file is parity-locked: it must stay byte-identical between consensflow-cc and
// consensflow-pi (enforced by the parity test). It is pure — no I/O, no host imports.

export const MAX_EVENTS = 2000;            // cap the retained trail (mirrors the 2MB stdout cap)
export const MAX_EVENT_CHARS = 8 * 1024;   // truncate any single oversized event's text/result

// Placeholder for a run that produced no usable answer text (timeout / empty). A non-empty,
// non-JSONL string so the opencode normalizer can't fall through to the raw-stream dump and
// surfaceOutput can detect "no answer" and render the trail instead.
export const OPENCODE_NO_ANSWER = "[no answer text returned — see the run's reasoning/tool trail]";

const clampText = (value) =>
  typeof value === "string" && value.length > MAX_EVENT_CHARS ? value.slice(0, MAX_EVENT_CHARS) + "…" : value;

const clampEvent = (event) => {
  const out = { ...event };
  if (typeof out.text === "string") out.text = clampText(out.text);
  if (typeof out.result === "string") out.result = clampText(out.result);
  return out;
};

// OpenCode (`run --format json`): assistant text rides in `part.text` on `type:"text"` events;
// tool calls are `type:"tool_use"` with `part.tool` + `part.state.input/output`; reasoning is
// best-effort from `part.state.metadata.openrouter.reasoning_details`.
function opencodeAdapter(event) {
  const out = [];
  const reasoning = event?.part?.state?.metadata?.openrouter?.reasoning_details;
  if (Array.isArray(reasoning)) {
    for (const detail of reasoning) {
      const text = typeof detail === "string" ? detail : (detail?.text ?? detail?.summary ?? "");
      if (text) out.push({ kind: "thinking", text });
    }
  }
  if (event?.type === "text" && typeof event.part?.text === "string") {
    if (event.part.text.trim()) out.push({ kind: "text", text: event.part.text });
  } else if (event?.type === "tool_use" && event.part) {
    const tool = event.part.tool ?? event.part.name;
    const state = event.part.state ?? {};
    out.push({ kind: "tool_call", tool, args: state.input ?? event.part.input });
    const result = state.output ?? event.part.output;
    if (result != null) {
      out.push({ kind: "tool_result", tool, result: typeof result === "string" ? result : JSON.stringify(result) });
    }
  }
  return out;
}

// Codex (`exec --json`): envelope events carry an `item`. command_execution items map to a
// tool_call on item.started and a tool_result on item.completed; agent_message items are
// assistant text; reasoning items (best-effort — absent from a plain exec run) map to thinking.
function codexAdapter(event) {
  const out = [];
  const item = event?.item;
  if (!item) return out;
  if (/reason/i.test(item.type ?? "")) {
    const text = item.text ?? item.summary ?? (Array.isArray(item.content) ? item.content.map((part) => part?.text ?? "").join("") : "");
    if (text && text.trim()) out.push({ kind: "thinking", text });
    return out;
  }
  if (item.type === "command_execution") {
    if (event.type === "item.started") {
      out.push({ kind: "tool_call", tool: "exec", args: { command: item.command } });
    } else if (event.type === "item.completed") {
      const result = item.aggregated_output ?? item.output ?? "";
      out.push({ kind: "tool_result", tool: "exec", result: typeof result === "string" ? result : JSON.stringify(result) });
    }
    return out;
  }
  if (item.type === "agent_message" && event.type === "item.completed" && typeof item.text === "string" && item.text.trim()) {
    out.push({ kind: "text", text: item.text });
  }
  return out;
}

// Pi (`--mode json`): tool_execution_start/end carry the tool name + args/result; assistant text
// arrives in message_end content blocks (reasoning/thinking blocks map to thinking, best-effort).
// turn_end/agent_end are end-of-turn summaries whose assistant text already streamed via
// message_end, so they are not re-emitted — final-answer extraction lives in findFinalJsonOutput.
function piAdapter(event) {
  const out = [];
  if (event?.type === "tool_execution_start") {
    out.push({ kind: "tool_call", tool: event.toolName, args: event.args });
    return out;
  }
  if (event?.type === "tool_execution_end") {
    out.push({ kind: "tool_result", tool: event.toolName, result: piResultText(event.result) });
    return out;
  }
  if (event?.type === "message_end" && event.message?.role === "assistant") {
    for (const block of event.message.content ?? []) {
      if ((block?.type === "reasoning" || block?.type === "thinking") && block.text) {
        out.push({ kind: "thinking", text: block.text });
      } else if (block?.type === "text" && block.text) {
        out.push({ kind: "text", text: block.text });
      }
    }
  }
  return out;
}

// Pi tool results arrive as { content: [{ type:"text", text }] } — flatten to a string.
function piResultText(result) {
  if (typeof result === "string") return result;
  const content = result?.content;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? "").filter(Boolean).join("\n");
  return JSON.stringify(result ?? "");
}

// claude-code (`--output-format stream-json`, complete content blocks — no --include-partial-messages):
// assistant messages carry thinking / tool_use / text blocks; a user message carries tool_result
// blocks. system / rate_limit / result envelopes aren't content (the final answer is extracted by
// findFinalJsonOutput's claude-code branch, not the trail).
function claudeAdapter(event) {
  const out = [];
  const content = event?.message?.content;
  if ((event?.type === "assistant" || event?.type === "user") && Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === "thinking" && block.thinking) out.push({ kind: "thinking", text: block.thinking });
      else if (block?.type === "tool_use") out.push({ kind: "tool_call", tool: block.name, args: block.input });
      else if (block?.type === "tool_result") out.push({ kind: "tool_result", result: claudeResultText(block.content) });
      else if (block?.type === "text" && block.text) out.push({ kind: "text", text: block.text });
    }
  }
  return out;
}

// claude tool_result content is a string or an array of {type:"text", text} blocks.
function claudeResultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === "string" ? part : part?.text ?? "")).filter(Boolean).join("\n");
  return JSON.stringify(content ?? "");
}

// Adapters are added per engine as their TDD cycle lands (opencode, then pi, codex, claude-code).
const ADAPTERS = { opencode: opencodeAdapter, codex: codexAdapter, pi: piAdapter, "claude-code": claudeAdapter };

// Map one parsed JSONL event to zero or more normalized events. Never throws: an unknown engine,
// unknown shape, or adapter bug yields [] so a single odd line can't break a whole run. Each
// emitted event's text/result is clamped to MAX_EVENT_CHARS.
export function adaptLine(kind, parsed) {
  const adapter = ADAPTERS[kind];
  if (!adapter || !parsed) return [];
  try {
    return (adapter(parsed) ?? []).map(clampEvent);
  } catch {
    return [];
  }
}

// Append events to a trail, capping its length at MAX_EVENTS. The buffered stdout (and the
// transcript backstop) remain the complete record; the in-memory trail is bounded so a
// long-running participant can't grow it without limit.
export function pushEvents(trail, events) {
  for (const event of events) {
    trail.push(event);
    if (trail.length > MAX_EVENTS) trail.shift(); // keep the most recent tail, drop the oldest
  }
  return trail;
}

const oneLine = (value, max = 200) => {
  const str = String(value ?? "").replace(/\s+/g, " ").trim();
  return str.length > max ? `${str.slice(0, max)}…` : str;
};

const argsPreview = (args) => {
  if (args == null) return "";
  if (typeof args === "string") return args;
  try { return JSON.stringify(args); } catch { return String(args); }
};

// Render one normalized event as a single display line — used for live --stream output and,
// joined, for the no-answer trail. Text/final events are the actual answer content and are kept
// whole (already clamped to MAX_EVENT_CHARS by adaptLine); thinking/tool lines get a preview.
export function renderEvent(event) {
  if (!event) return "";
  if (event.kind === "thinking") return `· thinking: ${oneLine(event.text)}`;
  if (event.kind === "tool_call") return `→ ${event.tool ?? "tool"}(${oneLine(argsPreview(event.args))})`;
  if (event.kind === "tool_result") return `← ${event.tool ?? "tool"}: ${oneLine(event.result)}`;
  if (event.kind === "text" || event.kind === "final") return String(event.text ?? "").trim();
  return "";
}

// Render the bounded event trail as a compact, human-readable block (thinking / tool calls /
// results / text). Used when a run has no usable final answer — never the raw JSONL stream.
export function renderTrail(events) {
  const lines = [];
  for (const event of events ?? []) {
    const line = renderEvent(event);
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

// Decide what the lead sees: the final answer when usable, otherwise the bounded trail under a
// clear no-answer header — the trail carries the partial text AND the reasoning/tool-call context.
// Never the raw JSONL stream, never a bare whitespace fragment.
export function surfaceOutput(answer, events) {
  const usable = typeof answer === "string" && answer.trim() !== "" && answer !== OPENCODE_NO_ANSWER;
  if (usable) return answer;
  const header = "⚠ no final answer — partial trail below";
  const body = renderTrail(events) || "";
  return body ? `${header}\n\n${body}` : header;
}

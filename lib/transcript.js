import fs from "node:fs/promises";
import { loadSession } from "./state.js";

const DEFAULT_MAX_BYTES = 120 * 1024;
const TOOL_RESULT_MAX_CHARS = 1500;
// ConsensFlow consultations live in the transcript only as Bash tool results (the lead runs
// cf.mjs via the Bash tool). Keep them near-whole so they cross-pollinate into later
// participants' handoffs the way @mention replies do in consensflow-pi.
const CF_TOOL_RESULT_MAX_CHARS = 20000;
const TOOL_ARGS_MAX_CHARS = 200;

// Matches a Bash command that invokes the ConsensFlow CLI's run subcommand, capturing the
// participant ref: node ".../bin/cf.mjs" run @zeus ...
const CF_RUN_COMMAND = /cf\.mjs["']?\s+run\s+@?([a-z0-9][a-z0-9-]*)/i;

// The Claude Code session transcript is a JSONL file (one entry per line). The format is
// internal/undocumented, so parse defensively: skip anything unrecognized, never throw.
export function parseTranscriptJsonl(raw) {
  const entries = [];
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (entry && typeof entry === "object") entries.push(entry);
    } catch {
      // Tolerate partial/corrupt lines (e.g. a write in progress).
    }
  }
  return entries;
}

// Serialize transcript entries (file order = chronological, oldest first) into readable text for
// a participant handoff. Skips sidechains (subagent traffic), meta/command noise, and thinking;
// keeps ConsensFlow consultation results near-whole; caps total size keeping the tail.
export function serializeClaudeTranscript(entries, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) return "";

  // First pass: map tool_use ids to their tool name/input so tool_result blocks can be labeled
  // (and ConsensFlow runs recognized) — results only carry the id.
  const toolUseById = new Map();
  for (const entry of list) {
    if (entry?.type !== "assistant" || entry.isSidechain === true) continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "tool_use" && block.id) toolUseById.set(block.id, { name: block.name, input: block.input });
    }
  }

  const blocks = [];
  let summaryPreamble = null;
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.isSidechain === true) continue;
    if (entry.type === "summary") {
      if (entry.summary && String(entry.summary).trim()) summaryPreamble = String(entry.summary).trim();
      continue;
    }
    const block = serializeEntry(entry, toolUseById);
    if (block) blocks.push(block);
  }
  if (summaryPreamble) blocks.unshift(`[Session summary]\n${summaryPreamble}`);
  if (blocks.length === 0) return "";

  return capTail(blocks.join("\n\n"), maxBytes);
}

function serializeEntry(entry, toolUseById) {
  if (entry.type === "user") return serializeUserEntry(entry, toolUseById);
  if (entry.type === "assistant") return serializeAssistantEntry(entry);
  return null; // system / attachment / file-history-snapshot / last-prompt / mode / progress: noise
}

function serializeUserEntry(entry, toolUseById) {
  const content = entry.message?.content;
  // Compaction summaries arrive as user entries flagged isCompactSummary.
  if (entry.isCompactSummary === true) {
    const text = flattenText(content);
    return text ? `[Earlier conversation summary]\n${text}` : null;
  }
  if (typeof content === "string") {
    return isUserNoise(content) || entry.isMeta === true ? null : prefixed("User", content);
  }
  if (!Array.isArray(content)) return null;

  const parts = [];
  for (const block of content) {
    if (typeof block === "string") {
      if (!isUserNoise(block) && entry.isMeta !== true) parts.push(prefixed("User", block));
      continue;
    }
    if (!block || typeof block !== "object") continue;
    if (block.type === "text") {
      if (block.text && !isUserNoise(block.text) && entry.isMeta !== true) parts.push(prefixed("User", block.text));
      continue;
    }
    if (block.type === "tool_result") {
      const origin = toolUseById?.get(block.tool_use_id);
      const cfMatch = origin?.name === "Bash" && typeof origin.input?.command === "string" ? origin.input.command.match(CF_RUN_COMMAND) : null;
      const maxChars = cfMatch ? CF_TOOL_RESULT_MAX_CHARS : TOOL_RESULT_MAX_CHARS;
      const body = truncate(flattenText(block.content), maxChars);
      if (!body) continue;
      const label = cfMatch ? ` consensflow run (@${cfMatch[1].toLowerCase()})` : origin?.name ? ` ${origin.name}` : "";
      parts.push(`Tool result${label}${block.is_error ? " (error)" : ""}:\n${body}`);
      continue;
    }
    if (block.type === "image") parts.push("[image]");
  }
  return parts.length ? parts.join("\n\n") : null;
}

function serializeAssistantEntry(entry) {
  const content = entry.message?.content;
  if (typeof content === "string") return prefixed("Lead", content);
  if (!Array.isArray(content)) return null;
  const parts = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== "object") continue;
    switch (block.type) {
      case "text":
        if (block.text) parts.push(block.text);
        break;
      case "tool_use":
        parts.push(`→ ${block.name}(${truncate(safeJson(block.input), TOOL_ARGS_MAX_CHARS)})`);
        break;
      case "thinking":
        break; // omit reasoning from the handoff
      default:
        if (typeof block.text === "string") parts.push(block.text);
    }
  }
  const text = parts.filter(Boolean).join("\n").trim();
  return text ? `Lead:\n${text}` : null;
}

// Local-command echoes and harness caveats are session plumbing, not conversation.
function isUserNoise(text) {
  const value = String(text ?? "").trimStart();
  return (
    value.startsWith("<command-name>") ||
    value.startsWith("<local-command-stdout>") ||
    value.startsWith("<system-reminder>") ||
    value.startsWith("Caveat: The messages below were generated")
  );
}

function prefixed(label, text) {
  const value = String(text ?? "").trim();
  return value ? `${label}:\n${value}` : null;
}

function flattenText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text" && typeof part.text === "string") return part.text;
      if (typeof part?.text === "string") return part.text;
      if (part?.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function truncate(value, maxChars) {
  const text = String(value ?? "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…[truncated]`;
}

// Keep the most recent tail (handoff context favors recent state), prefixing a marker when cut.
function capTail(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const marker = "[earlier handoff truncated]\n\n";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"));
  let tail = text.slice(-budget);
  while (Buffer.byteLength(tail, "utf8") > budget) tail = tail.slice(1);
  return `${marker}${tail}`;
}

// Build the handoff for the current workspace from the session stash the plugin hooks maintain
// (.consensflow/session.json → transcriptPath). Degrades to "" when anything is missing or
// unreadable — a handoff is context, never a precondition.
export async function collectHandoff(cwd, options = {}) {
  try {
    const session = await loadSession(cwd);
    const transcriptPath = session?.transcriptPath;
    if (!transcriptPath) return "";
    const raw = await fs.readFile(transcriptPath, "utf8");
    return serializeClaudeTranscript(parseTranscriptJsonl(raw), options);
  } catch {
    return "";
  }
}

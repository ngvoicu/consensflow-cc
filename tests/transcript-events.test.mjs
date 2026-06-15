import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { adaptLine, pushEvents, surfaceOutput, OPENCODE_NO_ANSWER, MAX_EVENTS, MAX_EVENT_CHARS } from "../lib/transcript-events.js";
import { buildRunnerInvocation, normalizeProcessOutput } from "../lib/runners.js";

const opencodeFixture = async () => {
  const raw = await readFile(new URL("./fixtures/opencode-timeout.sample.jsonl", import.meta.url), "utf8");
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
};

test("transcript-events: OpenCode adapter maps text/tool/thinking, skips unknowns, bounds the trail [STRM-05]", async () => {
  const events = (await opencodeFixture()).flatMap((parsed) => adaptLine("opencode", parsed));

  // text parts → text events; the substantive first part survives (not the trailing " ").
  const texts = events.filter((e) => e.kind === "text");
  assert.ok(texts.length >= 1, "at least one text event");
  assert.ok(texts.some((e) => /continue from where the lead left off/.test(e.text)), "keeps the substantive text");

  // tool_use → a tool_call (name + args) and a tool_result (the read output).
  const calls = events.filter((e) => e.kind === "tool_call");
  assert.ok(calls.length >= 1, "at least one tool_call");
  assert.equal(calls[0].tool, "read");
  assert.ok(calls[0].args && typeof calls[0].args === "object", "tool_call carries args");
  const results = events.filter((e) => e.kind === "tool_result");
  assert.ok(results.length >= 1 && typeof results[0].result === "string", "tool_result carries the output string");

  // reasoning_details (synthetic — absent in this fixture) → thinking events, best-effort.
  const thinking = adaptLine("opencode", {
    type: "step_finish",
    part: { state: { metadata: { openrouter: { reasoning_details: [{ type: "reasoning.text", text: "let me think" }] } } } },
  });
  assert.deepEqual(thinking, [{ kind: "thinking", text: "let me think" }]);

  // Unknown / malformed shapes never throw — they yield [].
  assert.deepEqual(adaptLine("opencode", { type: "totally_unknown" }), []);
  assert.deepEqual(adaptLine("opencode", null), []);
  assert.deepEqual(adaptLine("nonengine", { type: "text", part: { text: "x" } }), []);

  // Per-event text is truncated at MAX_EVENT_CHARS (+ an ellipsis).
  const big = adaptLine("opencode", { type: "text", part: { text: "z".repeat(MAX_EVENT_CHARS + 5000) } });
  assert.equal(big.length, 1);
  assert.ok(big[0].text.length <= MAX_EVENT_CHARS + 1, "single oversized event clamped");
  assert.ok(big[0].text.endsWith("…"), "truncation marker");

  // The retained trail count is capped at MAX_EVENTS.
  const trail = [];
  pushEvents(trail, Array.from({ length: MAX_EVENTS + 50 }, () => ({ kind: "text", text: "x" })));
  assert.equal(trail.length, MAX_EVENTS, "trail count capped");
});

const codexFixture = async () => {
  const raw = await readFile(new URL("./fixtures/codex-exec-json.sample.jsonl", import.meta.url), "utf8");
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
};

test("transcript-events: codex adapter maps exec tool calls, agent messages, and reasoning [STRM-09]", async () => {
  const events = (await codexFixture()).flatMap((parsed) => adaptLine("codex", parsed));

  // command_execution: item.started → tool_call(exec, command); item.completed → tool_result.
  const calls = events.filter((e) => e.kind === "tool_call");
  const results = events.filter((e) => e.kind === "tool_result");
  assert.ok(calls.length >= 1 && calls.every((c) => c.tool === "exec"), "exec tool calls");
  assert.ok(typeof calls[0].args?.command === "string", "tool_call carries the command");
  assert.ok(results.length >= 1 && typeof results[0].result === "string", "tool_result carries output");

  // agent_message → text; the final verdict text is present in the stream.
  const texts = events.filter((e) => e.kind === "text");
  assert.ok(texts.some((e) => /ship-with-changes/.test(e.text)), "agent message text surfaces");

  // reasoning item (synthetic — absent in exec --json, present in some configs) → thinking.
  assert.deepEqual(
    adaptLine("codex", { type: "item.completed", item: { type: "reasoning", text: "let me reason" } }),
    [{ kind: "thinking", text: "let me reason" }],
  );

  // Non-item envelope events never throw — they yield [].
  assert.deepEqual(adaptLine("codex", { type: "turn.completed" }), []);
  assert.deepEqual(adaptLine("codex", { type: "thread.started", thread_id: "t" }), []);
});

const piFixture = async () => {
  const raw = await readFile(new URL("./fixtures/pi-mode-json.sample.jsonl", import.meta.url), "utf8");
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
};

test("transcript-events: pi adapter maps tool_execution + assistant message_end (no end-summary dupes) [STRM-07]", async () => {
  const events = (await piFixture()).flatMap((parsed) => adaptLine("pi", parsed));

  // tool_execution_start → tool_call (toolName + args); tool_execution_end → tool_result.
  const calls = events.filter((e) => e.kind === "tool_call");
  const results = events.filter((e) => e.kind === "tool_result");
  assert.ok(calls.some((c) => c.tool === "read" && typeof c.args?.path === "string"), "read tool_call with args");
  assert.ok(results.some((r) => /hello world from the consensflow fixture/.test(r.result)), "tool_result carries the read output");

  // Assistant message_end text → text; the final one-word answer surfaces.
  const texts = events.filter((e) => e.kind === "text");
  assert.ok(texts.some((e) => /hello/i.test(e.text)), "assistant text surfaces");
  // user / toolResult message_end roles are skipped — the tool output must not leak in as "text".
  assert.ok(!texts.some((e) => /2 more lines/.test(e.text)), "tool output never leaks into a text event");

  // turn_end / agent_end are end-of-turn summaries — their assistant text already arrived via
  // message_end, so they must NOT re-emit it (no duplication). Final-answer extraction stays in
  // findFinalJsonOutput.
  assert.deepEqual(adaptLine("pi", { type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } }), []);
  assert.deepEqual(adaptLine("pi", { type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "hello" }] }] }), []);

  // reasoning/thinking content block (synthetic — absent in this fixture) → thinking.
  assert.deepEqual(
    adaptLine("pi", { type: "message_end", message: { role: "assistant", content: [{ type: "reasoning", text: "hmm" }] } }),
    [{ kind: "thinking", text: "hmm" }],
  );

  // Unknown / non-assistant shapes never throw — they yield [].
  assert.deepEqual(adaptLine("pi", { type: "turn_start" }), []);
  assert.deepEqual(adaptLine("pi", { type: "message_end", message: { role: "user", content: [{ type: "text", text: "x" }] } }), []);
});

test("surfaceOutput: usable answer passes through; no answer → bounded trail under a clear header, never raw JSONL [STRM-13]", () => {
  const events = [
    { kind: "thinking", text: "let me look" },
    { kind: "tool_call", tool: "read", args: { path: "a.txt" } },
    { kind: "tool_result", tool: "read", result: "file body" },
    { kind: "text", text: "partial answer so far" },
  ];
  // Usable answer, no timeout → returned verbatim.
  assert.equal(surfaceOutput("The answer is 42.", events, false), "The answer is 42.");
  // Timed out but with a (partial) usable answer → answer under a timeout header.
  const partial = surfaceOutput("partial answer so far", events, true);
  assert.match(partial, /timed out/i);
  assert.match(partial, /partial answer so far/);
  // No usable answer (the opencode placeholder) + timeout → the bounded trail under the header.
  const trail = surfaceOutput(OPENCODE_NO_ANSWER, events, true);
  assert.match(trail, /timed out/i);
  assert.match(trail, /read/, "tool call surfaced in the trail");
  assert.match(trail, /let me look/, "thinking surfaced in the trail");
  assert.doesNotMatch(trail, /"kind"|"type":|sessionID/, "never the raw JSONL stream");
  // Empty answer, no timeout → a clear no-answer header + the trail.
  const empty = surfaceOutput("", events, false);
  assert.match(empty, /no final answer/i);
  assert.match(empty, /read/);
});

const claudeStreamFixture = async () =>
  (await readFile(new URL("./fixtures/claude-stream-json.sample.jsonl", import.meta.url), "utf8")).split(/\r?\n/).filter(Boolean);

test("transcript-events: claude adapter (stream-json content blocks) + final extraction + invocation [STRM-11]", async () => {
  const lines = await claudeStreamFixture();
  const events = lines.map((l) => JSON.parse(l)).flatMap((p) => adaptLine("claude-code", p));

  // assistant content blocks → thinking / tool_call / text; user tool_result → tool_result.
  assert.ok(events.some((e) => e.kind === "thinking"), "thinking block surfaces");
  const calls = events.filter((e) => e.kind === "tool_call");
  assert.ok(calls.some((c) => c.tool === "Read" && c.args), "tool_use → tool_call (Read, with args)");
  assert.ok(events.some((e) => e.kind === "tool_result" && /hello world from the consensflow fixture/.test(e.result)), "tool_result content surfaces");
  assert.ok(events.some((e) => e.kind === "text" && /hello/i.test(e.text)), "final text block surfaces");
  // system / rate_limit / result envelopes are not content and yield no events.
  assert.deepEqual(adaptLine("claude-code", { type: "system", subtype: "init" }), []);
  assert.deepEqual(adaptLine("claude-code", { type: "rate_limit_event" }), []);

  // normalizeProcessOutput on the multi-line stream-json extracts the final answer via the
  // dedicated claude-code branch in findFinalJsonOutput (the generic blob parser no longer applies).
  assert.equal(normalizeProcessOutput("claude-code", lines.join("\n"), "").output, "hello");
  // Backward-compatible: a single-blob result/array still parses (the tryParseJson fast path).
  assert.equal(normalizeProcessOutput("claude-code", JSON.stringify({ type: "result", result: "SOLO" }), "").output, "SOLO");

  // The invocation requests stream-json + --verbose, and NOT --include-partial-messages (we want
  // complete content-block events, not token-level deltas).
  const inv = buildRunnerInvocation({ kind: "claude-code", toolsPolicy: "readonly", model: "claude-opus-4-8" }, "/tmp/p.md", "/repo");
  assert.ok(inv.args.includes("stream-json"), "stream-json output format");
  assert.ok(inv.args.includes("--verbose"), "stream-json requires --verbose");
  assert.equal(inv.args.includes("--include-partial-messages"), false, "no token-level deltas");
});

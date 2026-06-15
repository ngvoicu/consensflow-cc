import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createId, nowIso, resolveInside, truncateText } from "./utils.js";
import { ensureCfDirs, recordLatestRun, runsRoot } from "./state.js";
import { adaptLine, pushEvents, renderTrail, surfaceOutput, OPENCODE_NO_ANSWER } from "./transcript-events.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

// Every participant subprocess gets this marker so ConsensFlow tooling running inside the child
// (the plugin hooks, or cf.mjs itself) can detect the nesting and bail — the CC analog of pi
// participants running with --no-extensions.
export const CHILD_ENV = { CONSENSFLOW_CHILD: "1" };

export function toolsForPi(policy) {
  if (policy === "readonly") return "read,grep,find,ls";
  return "read,grep,find,ls,bash,edit,write";
}

export function claudeAllowedTools(policy) {
  if (policy === "readonly") return "Read,Grep,Glob";
  return "Read,Grep,Glob,Edit,Write,Bash";
}

// --allowedTools only pre-approves; it does not block tools the user's own settings allow.
// Readonly must also deny, or a broad user-level Bash allowlist leaks write capability in.
export const CLAUDE_READONLY_DISALLOWED = "Bash,Edit,MultiEdit,NotebookEdit,Write";

// Permission overlay for readonly opencode runs: opencode defaults to edit/bash "allow", so
// without this a "read-only" participant could edit files. Denying `edit` covers the
// write/edit/patch tools; read/grep/glob stay available.
export const OPENCODE_READONLY_PERMISSION = JSON.stringify({ edit: "deny", bash: "deny" });

export function codexSandbox(policy) {
  if (policy === "readonly") return "read-only";
  if (policy === "workspace-write") return "workspace-write";
  return "danger-full-access";
}

export function buildRunnerInvocation(participant, packetPath, cwd) {
  const p = participant;
  switch (p.kind) {
    case "pi": {
      const args = ["--mode", "json", "--no-session", "--no-extensions"];
      if (p.skillsPolicy === "none" || p.skillsPolicy === "explicit") args.push("--no-skills");
      if (p.skillsPolicy === "explicit") {
        for (const skillPath of p.skillPaths ?? []) args.push("--skill", skillPath);
      }
      if (p.model) args.push("--model", p.model);
      args.push("--thinking", p.thinking ?? "off");
      args.push("--tools", toolsForPi(p.toolsPolicy), "-p", "Follow the ConsensFlow packet provided on stdin. Return only the requested output.");
      return { command: "pi", args, stdinMode: "packet", cwd, env: { ...CHILD_ENV } };
    }
    case "claude-code": {
      // --bare skips the child's plugin/hook/skill/CLAUDE.md discovery — the claude analog of pi's
      // --no-extensions. Without it a claude child would load this very plugin and its
      // UserPromptSubmit hook could stomp the lead session's ConsensFlow session.json stash.
      // stream-json (JSONL) surfaces complete content-block events as the run streams — thinking,
      // tool_use, text — which the adapter relays for --stream and the transcript. --verbose is
      // required for stream-json in -p mode; we deliberately omit --include-partial-messages (we
      // want complete blocks, not token-level deltas).
      const args = ["-p", "Follow the ConsensFlow packet provided on stdin. Return only the requested output.", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--bare", "--allowedTools", claudeAllowedTools(p.toolsPolicy)];
      if (p.toolsPolicy === "readonly") args.push("--disallowedTools", CLAUDE_READONLY_DISALLOWED);
      if (p.model) args.push("--model", p.model);
      if (p.effort) args.push("--effort", p.effort);
      if (p.maxTurns) args.push("--max-turns", String(p.maxTurns));
      if (p.toolsPolicy === "full-auto") args.push("--dangerously-skip-permissions");
      // Without the env key, claude falls back to the subscription login; with it, it silently
      // bills the API. Strip it so participant runs always ride the configured login.
      return { command: "claude", args, stdinMode: "packet", cwd, env: { ...CHILD_ENV }, dropEnv: ["ANTHROPIC_API_KEY"] };
    }
    case "codex": {
      const args = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--sandbox", codexSandbox(p.toolsPolicy), "-C", cwd];
      if (p.model) args.push("--model", p.model);
      if (p.effort) args.push("-c", `model_reasoning_effort=\"${p.effort}\"`);
      if (p.toolsPolicy === "full-auto") args.push("--dangerously-bypass-approvals-and-sandbox");
      args.push("-");
      // Same billing guard as claude: a set OPENAI_API_KEY would switch codex off the ChatGPT login.
      return { command: "codex", args, stdinMode: "packet", cwd, env: { ...CHILD_ENV }, dropEnv: ["OPENAI_API_KEY"] };
    }
    case "opencode": {
      const args = ["run", "--format", "json", "--dir", cwd, "--file", packetPath];
      if (p.model) args.push("--model", p.model);
      if (p.effort) args.push("--variant", p.effort);
      if (p.agent) args.push("--agent", p.agent);
      if (p.toolsPolicy === "full-auto") args.push("--dangerously-skip-permissions");
      args.push("Follow the ConsensFlow packet attached as a file. Return only the requested output.");
      const env = p.toolsPolicy === "readonly" ? { ...CHILD_ENV, OPENCODE_PERMISSION: OPENCODE_READONLY_PERMISSION } : { ...CHILD_ENV };
      return { command: "opencode", args, stdinMode: "none", cwd, env };
    }
    case "image":
      throw new Error("image participants are generated via the Codex backend, not a CLI runner (bug: should be handled upstream in the image path)");
    default:
      throw new Error(`Unsupported participant kind: ${p.kind}`);
  }
}

// An explicit per-call override wins over the participant's configured timeout, then the default.
export function effectiveTimeoutMs(participant, requestedMs) {
  return Number(requestedMs) || Number(participant?.timeoutMs) || DEFAULT_TIMEOUT_MS;
}

export async function runParticipant(input) {
  const { cwd, participant, packet, kind = "ask", signal, onEvent } = input;
  await ensureCfDirs(cwd);
  const runId = input.runId ?? createId(kind);
  const runDir = path.join(runsRoot(cwd), runId);
  await fs.mkdir(runDir, { recursive: true });
  const packetPath = path.join(runDir, "packet.md");
  await fs.writeFile(packetPath, packet, "utf8");

  const invocationCwd = participant.cwd ? resolveInside(cwd, participant.cwd) : path.resolve(cwd);
  const invocation = buildRunnerInvocation(participant, packetPath, invocationCwd);
  // Build a bounded, normalized event trail as the run streams, and forward each event to onEvent
  // (--stream / onUpdate). The trail feeds surfaceOutput's timeout fallback and the transcript
  // backstop. tryParseJson tolerates non-JSONL lines (returns null → skipped); adaptLine never throws.
  const events = [];
  const onStdoutLine = (line) => {
    const parsed = tryParseJson(line);
    if (!parsed) return;
    const adapted = adaptLine(participant.kind, parsed);
    if (adapted.length === 0) return;
    pushEvents(events, adapted);
    if (onEvent) for (const event of adapted) onEvent(event);
  };
  const startedAt = nowIso();
  const procResult = await spawnWithInput(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    input: invocation.stdinMode === "packet" ? packet : undefined,
    env: invocation.env,
    dropEnv: invocation.dropEnv,
    signal,
    timeoutMs: effectiveTimeoutMs(participant, input.timeoutMs),
    onStdoutLine,
  });
  const endedAt = nowIso();

  await fs.writeFile(path.join(runDir, "stdout.txt"), procResult.stdout, "utf8");
  await fs.writeFile(path.join(runDir, "stderr.txt"), procResult.stderr, "utf8");
  const normalized = normalizeProcessOutput(participant.kind, procResult.stdout, procResult.stderr);
  // Surface the final answer when usable; on timeout / no answer, the bounded trail under a clear
  // header — never the raw JSONL stream, never a bare whitespace fragment.
  const output = surfaceOutput(normalized.output, events, procResult.timedOut);
  // Durability backstop: a human-readable transcript of the run's thinking / tool calls / answer
  // (the event trail) written to the run dir — the record that survives a killed/backgrounded run
  // whose buffered stdout is lost. Falls back to the final output when no events were streamed.
  const transcriptPath = path.join(runDir, "transcript.md");
  const transcriptBody = renderTrail(events) || output || "";
  await fs.writeFile(transcriptPath, transcriptBody ? `${transcriptBody}\n` : "", "utf8");
  const result = {
    schemaVersion: 1,
    runId,
    runDir,
    packetPath,
    kind,
    participant,
    invocation: { command: invocation.command, args: invocation.args, cwd: invocation.cwd },
    startedAt,
    endedAt,
    exitCode: procResult.exitCode,
    timedOut: procResult.timedOut,
    signal: procResult.signal,
    output,
    transcriptPath,
    rawOutputTruncated: procResult.truncated,
    stderr: truncateText(procResult.stderr, 64 * 1024).text,
  };
  await fs.writeFile(path.join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await recordLatestRun(cwd, result);
  return result;
}

export async function spawnWithInput(command, args, options = {}) {
  const { cwd = process.cwd(), input, signal, timeoutMs = DEFAULT_TIMEOUT_MS, env: envOverrides, dropEnv, onStdoutLine } = options;
  let env;
  if (envOverrides || (dropEnv && dropEnv.length > 0)) {
    env = { ...process.env, ...(envOverrides ?? {}) };
    for (const key of dropEnv ?? []) delete env[key];
  }
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;
    let timedOut = false;
    let timeout;

    const append = (target, chunk) => {
      const text = chunk.toString();
      if (target === "stdout") stdout += text;
      else stderr += text;
      if (Buffer.byteLength(stdout, "utf8") > MAX_CAPTURE_BYTES) {
        stdout = truncateTail(stdout, MAX_CAPTURE_BYTES).text;
        truncated = true;
      }
      if (Buffer.byteLength(stderr, "utf8") > MAX_CAPTURE_BYTES) {
        stderr = truncateTail(stderr, MAX_CAPTURE_BYTES).text;
        truncated = true;
      }
    };

    // Incremental line delivery: accumulate stdout into a carry buffer, emit each COMPLETE line
    // (CRLF-stripped, blank lines skipped) through onStdoutLine, and flush a residual newline-less
    // line on close. Read-only with respect to the buffered `stdout` above — same bytes, just also
    // surfaced line-by-line for live streaming / the transcript backstop.
    let lineBuf = "";
    const pump = (flush) => {
      if (!onStdoutLine) return;
      let nl;
      while ((nl = lineBuf.indexOf("\n")) !== -1) {
        const line = lineBuf.slice(0, nl).replace(/\r$/, "");
        lineBuf = lineBuf.slice(nl + 1);
        if (line.trim()) onStdoutLine(line);
      }
      if (flush && lineBuf.trim()) { onStdoutLine(lineBuf.replace(/\r$/, "")); lineBuf = ""; }
    };

    const finish = (exitCode, sig) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", abortHandler);
      resolve({ stdout, stderr, exitCode, signal: sig, timedOut, truncated });
    };

    const forceKillIfAlive = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    };

    const abortHandler = () => {
      child.kill("SIGTERM");
      setTimeout(forceKillIfAlive, 3000).unref?.();
    };

    if (signal) {
      if (signal.aborted) abortHandler();
      else signal.addEventListener("abort", abortHandler, { once: true });
    }

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(forceKillIfAlive, 3000).unref?.();
    }, timeoutMs);
    timeout.unref?.();

    child.stdout.on("data", (chunk) => {
      append("stdout", chunk);
      if (onStdoutLine) { lineBuf += chunk.toString(); pump(false); }
    });
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => {
      stderr += `\n[spawn error] ${error.message}`;
      finish(127, null);
    });
    child.on("close", (code, sig) => { pump(true); finish(code ?? 0, sig); });

    // A child that exits before consuming stdin (bad flag, login failure) raises EPIPE here;
    // without a listener that is an uncaughtException that kills the host process.
    child.stdin.on("error", (error) => append("stderr", `\n[stdin error] ${error.message}`));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function normalizeProcessOutput(kind, stdout, stderr = "") {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) return { output: stderr.trim() || "[no output]", parsed: null };

  if (kind === "claude-code") {
    const parsed = tryParseJson(trimmed);
    if (parsed) {
      if (Array.isArray(parsed)) {
        for (let i = parsed.length - 1; i >= 0; i -= 1) {
          const event = parsed[i];
          if (typeof event?.result === "string") return { output: event.result, parsed };
          if (typeof event?.message?.content === "string") return { output: event.message.content, parsed };
          const text = contentToText(event?.message?.content);
          if (text) return { output: text, parsed };
        }
      }
      return { output: parsed.result ?? parsed.structured_output ?? JSON.stringify(parsed, null, 2), parsed };
    }
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  const parsedLines = lines.map((line) => tryParseJson(line)).filter(Boolean);
  if (parsedLines.length > 0) {
    const final = findFinalJsonOutput(kind, parsedLines);
    if (final) return { output: final, parsed: parsedLines };
  }

  return { output: trimmed, parsed: null };
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findFinalJsonOutput(kind, events) {
  if (kind === "claude-code") {
    // stream-json: the terminal {type:"result"} carries the final answer; fall back to the last
    // assistant message's text content blocks if a run ends without a result event. (The old
    // whole-blob tryParseJson path in normalizeProcessOutput no longer matches multi-line JSONL.)
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.type === "result" && typeof event.result === "string") return event.result;
      if (event.type === "assistant" && Array.isArray(event.message?.content)) {
        const text = contentToText(event.message.content);
        if (text) return text;
      }
    }
  }

  if (kind === "pi") {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.type === "agent_end" && Array.isArray(event.messages)) {
        const message = [...event.messages].reverse().find((entry) => entry?.role === "assistant");
        const text = contentToText(message?.content);
        if (text) return text;
      }
      if ((event.type === "message_end" || event.type === "turn_end") && event.message?.role === "assistant") {
        const text = contentToText(event.message.content);
        if (text) return text;
      }
      if (event.assistantMessageEvent?.type === "text_end" && typeof event.assistantMessageEvent.content === "string") {
        return event.assistantMessageEvent.content;
      }
    }
  }

  if (kind === "codex") {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      const message = event.message ?? event.msg ?? event.item;
      if (typeof event.result === "string") return event.result;
      if (typeof event.output === "string") return event.output;
      if (typeof message === "string") return message;
      if (typeof message?.text === "string") return message.text;
      if (message?.content) return contentToText(message.content);
    }
  }

  if (kind === "opencode") {
    // Concatenate ALL text parts in order — not just the last, which on a timed-out run is a
    // trailing whitespace fragment (the blank-output bug). OpenCode carries answer text in
    // `part.text` on `type:"text"` events. Return a fixed placeholder (never null/empty) so we
    // can't fall through to the generic raw-JSONL dump.
    const answer = events
      .filter((event) => event.type === "text" && typeof event.part?.text === "string")
      .map((event) => event.part.text)
      .join("")
      .trim();
    return answer || OPENCODE_NO_ANSWER;
  }

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (typeof event.result === "string") return event.result;
    if (typeof event.output === "string") return event.output;
    if (typeof event.text === "string") return event.text;
  }
  return null;
}

function truncateTail(text, maxBytes) {
  const value = String(text ?? "");
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) return { text: value, truncated: false, bytes };
  const marker = `\n[truncated: kept tail, ${bytes - maxBytes} bytes omitted]\n`;
  const markerBytes = Buffer.byteLength(marker, "utf8");
  let tail = value.slice(Math.max(0, value.length - (maxBytes - markerBytes)));
  while (Buffer.byteLength(tail, "utf8") + markerBytes > maxBytes) tail = tail.slice(1);
  return { text: `${marker}${tail}`, truncated: true, bytes };
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text;
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

#!/usr/bin/env node
// ConsensFlow CC — the CLI the Claude Code lead drives via the Bash tool.
// Mirrors consensflow-pi's /consensflow:cf router: participants admin, doctor, status, and one-at-a-time runs.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { codexAuthPath, loadCodexAuth } from "../lib/codex-auth.js";
import { generateImage, imageFileToDataUrl, IMAGE_BACKEND, IMAGE_TRIGGER_DEFAULT, saveImagePng } from "../lib/image.js";
import { formatPresets, getPreset, listPresetIds, participantFromPreset } from "../lib/presets.js";
import {
  cfRoot,
  configHome,
  ensureCfDirs,
  getParticipant,
  loadCurrent,
  loadParticipants,
  loadSession,
  participantsPath,
  recordLatestRun,
  removeParticipant,
  runsRoot,
  upsertParticipant,
} from "../lib/state.js";
import { collectHandoff } from "../lib/transcript.js";
import { createId, parseOptions, slugify } from "../lib/utils.js";
import { effectiveTimeoutMs, runParticipant, spawnWithInput } from "../lib/runners.js";
import { renderEvent } from "../lib/transcript-events.js";
import { createPacket } from "../lib/packets.js";
import { effectiveToolsPolicy, participantForKind } from "../lib/workflows.js";

async function main() {
  const cwd = process.cwd();
  const tokens = process.argv.slice(2);
  if (tokens.length === 0) return await handleStatus(cwd);

  // Bare `cf @zeus <prompt>` routes like `cf run @zeus <prompt>` (parity with /consensflow:cf @zeus).
  const command = tokens[0].startsWith("@") ? "run" : tokens.shift();
  switch (command) {
    case "status":
    case "state":
      return await handleStatus(cwd);
    case "doctor":
      return await handleDoctor(cwd);
    case "participants":
    case "participant":
      return await handleParticipants(tokens, cwd);
    case "run":
    case "ask":
      return await handleRun(tokens, cwd);
    case "help":
    default:
      console.log(helpText());
  }
}

async function handleStatus(cwd) {
  const participants = await loadParticipants(cwd);
  const current = await loadCurrent(cwd);
  const session = await loadSession(cwd);
  console.log(
    [
      "# ConsensFlow status",
      "",
      `ConsensFlow home: ${configHome()}`,
      `Participants file: ${participantsPath(cwd)}`,
      `Artifact root for this workspace: ${cfRoot(cwd)}`,
      `Session stash: ${session.transcriptPath ? `transcript tracked (${session.transcriptPath})` : "no transcript tracked yet — handoffs will be empty until the plugin hooks run"}`,
      `Participants: ${participants.length}`,
      `Latest run: ${current.latestRunId ?? "none"}`,
      "",
      formatParticipants(participants, cwd),
    ].join("\n"),
  );
}

async function handleDoctor(cwd) {
  const KIND_BINARY = { pi: "pi", "claude-code": "claude", codex: "codex", opencode: "opencode" };
  const binaries = ["pi", "claude", "codex", "opencode"];
  const participants = await loadParticipants(cwd).catch(() => []);
  const neededBy = {};
  for (const p of participants) {
    const binary = KIND_BINARY[p.kind];
    if (binary) (neededBy[binary] ??= []).push(`@${p.id}`);
  }
  const rows = [];
  for (const binary of binaries) {
    const result = await spawnWithInput(binary, ["--version"], { cwd, timeoutMs: 5000 });
    rows.push({ binary, ok: result.exitCode === 0, output: (result.stdout || result.stderr || "").trim(), neededBy: neededBy[binary] ?? [] });
  }
  const imageParticipants = participants.filter((p) => p.kind === "image").map((p) => `@${p.id}`);
  const missing = rows.filter((row) => !row.ok && row.neededBy.length > 0);
  const lines = [
    "# ConsensFlow doctor",
    "",
    `ConsensFlow home: ${configHome()}`,
    `Participants file: ${participantsPath(cwd)}`,
    "",
    ...rows.map((row) => {
      const need = row.neededBy.length > 0 ? ` — needed by ${row.neededBy.join(", ")}` : " — not used by any participant";
      return `- ${row.ok ? "✓" : "✗"} ${row.binary}: ${row.output || "not available"}${need}`;
    }),
  ];
  if (imageParticipants.length > 0) {
    const codexAuth = await loadCodexAuth().catch(() => null);
    lines.push("", `- ${codexAuth ? "✓" : "✗"} codex login (gpt-image-2 backend) — needed by ${imageParticipants.join(", ")}${codexAuth ? "" : ` — run \`codex login\` (checked ${codexAuthPath()})`}`);
  }
  if (missing.length > 0) {
    lines.push("", "Missing engines that configured participants need:", ...missing.map((row) => `  - ${row.binary} (needed by ${row.neededBy.join(", ")})`));
  }
  console.log(lines.join("\n"));
}

async function handleParticipants(tokens, cwd) {
  await ensureCfDirs(cwd);
  const sub = tokens.shift() ?? "list";
  if (sub === "list") {
    console.log(formatParticipants(await loadParticipants(cwd), cwd));
    return;
  }
  if (sub === "presets" || sub === "preset") {
    console.log(formatPresets());
    return;
  }
  if (sub === "show") {
    const ref = tokens[0];
    if (!ref) throw new Error("Usage: /consensflow:participants show @name");
    const participant = await getParticipant(cwd, ref);
    if (!participant) throw new Error(`Unknown participant: ${ref}`);
    console.log(`# ${participant.name}\n\n\`\`\`json\n${JSON.stringify(participant, null, 2)}\n\`\`\``);
    return;
  }
  if (sub === "remove" || sub === "rm") {
    const ref = tokens[0];
    if (!ref) throw new Error("Usage: /consensflow:participants remove @name");
    const removed = await removeParticipant(cwd, ref);
    console.log(removed ? `Removed ${ref}.` : `No participant matched ${ref}.`);
    return;
  }
  if (sub === "add") {
    const parsed = parseOptions(tokens);
    const presetRef = parsed.positional[0];

    // Add every preset at once.
    if (presetRef === "all") {
      // `--name`/`--id` would make every preset derive the same id and overwrite each other.
      // Only allow flags that apply uniformly to a bulk add.
      assertAllowedFlags(parsed.flags, ["cwd", "timeoutMs", "description"], "preset add all");
      const participants = [];
      for (const presetId of listPresetIds()) {
        participants.push(await upsertParticipant(cwd, participantFromPreset(presetId, presetOverrides(parsed.flags))));
      }
      console.log(`Saved ${participants.length} presets in ${participantsPath(cwd)}.\n\n${participants.map(formatParticipantLine).join("\n")}`);
      return;
    }

    // Preset path: positional names a known preset; --name optionally renames it.
    if (presetRef && getPreset(presetRef)) {
      assertAllowedFlags(parsed.flags, PRESET_OVERRIDE_FLAGS, "preset add");
      const participant = await upsertParticipant(cwd, participantFromPreset(presetRef, presetOverrides(parsed.flags)));
      const from = participant.preset && participant.preset !== participant.id ? ` from preset \`${participant.preset}\`` : "";
      console.log(`Saved participant @${participant.id}${from} in ${participantsPath(cwd)}.\n\n${formatParticipantLine(participant)}`);
      return;
    }

    // Custom path: explicit custom intent via --name or any backend flag. A positional serves as the name.
    if (stringFlag(parsed.flags.name) !== undefined || hasCustomShape(parsed.flags)) {
      assertAllowedFlags(parsed.flags, CUSTOM_ADD_FLAGS, "custom add");
      const name = stringFlag(parsed.flags.name) ?? presetRef;
      if (!name) throw new Error("Custom participant needs a name: /consensflow:participants add --name <name> --kind <kind> --model <model> ...");
      const participant = await upsertParticipant(cwd, customParticipantInput(name, parsed.flags));
      console.log(`Saved custom participant @${participant.id} in ${participantsPath(cwd)}.\n\n${formatParticipantLine(participant)}`);
      return;
    }

    if (presetRef) {
      throw new Error(
        `Unknown preset: ${presetRef}\n\nPresets: ${listPresetIds().join(", ")} (rename any with --name).\n\nOr create a custom participant:\n  /consensflow:participants add --name <name> --kind <pi|claude-code|codex|opencode|image> --model <model> [--effort <e>] [--tools <workspace-write|full-auto>]`,
      );
    }
    throw new Error(addUsage());
  }
  throw new Error("Usage: /consensflow:participants list|presets|add|show|remove");
}

async function handleRun(tokens, cwd) {
  // The CC analog of pi participants running with --no-extensions: a participant subprocess must
  // not consult further participants (no fan-out, no recursion).
  if (process.env.CONSENSFLOW_CHILD) {
    throw new Error("Nested ConsensFlow runs are disabled inside participant subprocesses.");
  }
  await ensureCfDirs(cwd);
  const parsed = parseRunOptions(tokens);
  const positional = [...parsed.positional];
  const ref = positional.shift();
  if (!ref || !ref.startsWith("@")) {
    throw new Error("Usage: /consensflow:cf @name <prompt> — or via the Bash tool: run @name <prompt> [--prompt-file <file>] [--context <note>] [--no-handoff] [--timeout-ms <ms>] [--json]");
  }
  if (positional[0]?.startsWith("@")) {
    throw new Error("ConsensFlow sends to one participant at a time. Ask one, read its answer, then ask another.");
  }

  const participant = await getParticipant(cwd, ref);
  if (!participant) {
    const known = (await loadParticipants(cwd)).map((p) => `@${p.id}`).join(", ") || "none configured — add one with `/consensflow:participants add <preset>` (see `/consensflow:presets`)";
    throw new Error(`Unknown participant: @${slugify(String(ref).replace(/^@+/, ""))}. Configured: ${known}`);
  }

  let prompt = positional.join(" ");
  if (stringFlag(parsed.flags.prompt) !== undefined) prompt = String(parsed.flags.prompt);
  if (stringFlag(parsed.flags["prompt-file"]) !== undefined) prompt = await fs.readFile(String(parsed.flags["prompt-file"]), "utf8");
  prompt = prompt.trim();
  if (!prompt) throw new Error(`Prompt is required after @${participant.id} (inline, --prompt, or --prompt-file).`);

  // Image participants bypass the CLI runner: prompt-only (no packet/handoff), Codex backend.
  if (participant.kind === "image") return await runImageParticipant(cwd, participant, prompt, parsed.flags);

  // Only an unexpectedly-empty handoff is surfaced in the run output — a silently-missing session
  // stash would otherwise look identical to a full handoff from the participant's answer alone.
  let handoff = "";
  let handoffSummary = "skipped (--no-handoff)";
  if (flagBool(parsed.flags, "handoff") ?? true) {
    handoff = stringFlag(parsed.flags["handoff-file"]) !== undefined
      ? await fs.readFile(String(parsed.flags["handoff-file"]), "utf8")
      : await collectHandoff(cwd);
    handoffSummary = handoff.trim()
      ? `attached (${Math.max(1, Math.round(Buffer.byteLength(handoff, "utf8") / 1024))} KB)`
      : "empty — no session transcript stashed for this workspace (are the plugin hooks running?)";
  }

  // Per-call tools override: `--rw` is shorthand for workspace-write, or `--tools <policy>` for an
  // exact policy. The stored policy is the default; an explicit flag makes this one run write-capable
  // without a second roster entry. An invalid --tools value throws (validated downstream).
  const toolsOverride = parsed.flags.rw === true ? "workspace-write" : stringFlag(parsed.flags.tools);
  const effective = participantForKind(participant, "ask", toolsOverride);
  const packet = await createPacket({ cwd, participant: effective, kind: "ask", task: prompt, extraContext: stringFlag(parsed.flags.context), handoff });
  // PRIMARY observability path: with --stream, render normalized events to stdout as they arrive,
  // so the lead can relay the participant's thinking / tool calls / answer into this session
  // (foreground-incremental). Suppressed under --json so streamed lines can't corrupt JSON.
  const onEvent = parsed.flags.stream === true && parsed.flags.json !== true
    ? (event) => {
      const line = renderEvent(event);
      if (line) process.stdout.write(`${line}\n`);
    }
    : undefined;
  const result = await runParticipant({ cwd, participant: effective, packet, kind: "ask", timeoutMs: parsed.flags["timeout-ms"] ?? parsed.flags.timeoutMs, onEvent });
  result.handoffSummary = handoffSummary;

  if (parsed.flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  // Always print the parsed final result after the child exits, even with --stream. Some engine
  // streams omit answer text until the terminal summary. This mirrors Pi: live crumbs are
  // best-effort; the final reply is durable.
  console.log(renderRunResult(result));
}

export function parseRunOptions(tokens) {
  const positional = [];
  const flags = {};
  const valueFlags = new Set(["tools", "toolsPolicy", "context", "timeout-ms", "timeoutMs", "prompt", "prompt-file", "handoff-file", "image"]);
  const booleanFlags = new Set(["stream", "json", "rw", "handoff", "no-handoff"]);
  // Repeatable flags collect into an array: `--image a.png --image b.png` → ["a.png", "b.png"].
  const multiValueFlags = new Set(["image"]);
  const setValue = (name, value) => {
    if (multiValueFlags.has(name)) (flags[name] ??= []).push(value);
    else flags[name] = value;
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--") || token === "--") {
      positional.push(token);
      continue;
    }
    const raw = token.slice(2);
    const eq = raw.indexOf("=");
    const name = eq >= 0 ? raw.slice(0, eq) : raw;
    if (eq >= 0) {
      if (valueFlags.has(name)) setValue(name, raw.slice(eq + 1));
      else if (booleanFlags.has(name)) flags[name] = raw.slice(eq + 1) !== "false";
      else positional.push(token);
      continue;
    }
    if (booleanFlags.has(name)) {
      flags[name] = true;
      continue;
    }
    if (valueFlags.has(name)) {
      const next = tokens[i + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`--${name} requires a value`);
      setValue(name, next);
      i += 1;
      continue;
    }
    // Unknown --flags are treated as prompt text, so pasted commands like `git diff --stat` are
    // not stripped from the participant task.
    positional.push(token);
  }
  return { positional, flags };
}

// Image generation doesn't fit the text-CLI runner: it calls the Codex Responses backend
// (gpt-image-2) over HTTP, riding the Codex CLI's ChatGPT login. The image model gets the
// prompt verbatim (no packet/handoff) — an image model can't use the transcript.
async function runImageParticipant(cwd, participant, prompt, flags) {
  const { token, accountId } = await loadCodexAuth();
  const runId = createId("image");
  const runDir = path.join(runsRoot(cwd), runId);
  await fs.mkdir(runDir, { recursive: true });
  const triggerModel = participant.model || IMAGE_TRIGGER_DEFAULT;
  const timeoutMs = effectiveTimeoutMs(participant, flags["timeout-ms"]);
  // Optional reference images (`--image <path>`, repeatable) become input_image parts so gpt-image-2
  // can edit/condition on them. Paths are read as given (relative to cwd, like --prompt-file).
  const imagePaths = Array.isArray(flags.image) ? flags.image : flags.image ? [flags.image] : [];
  const images = await Promise.all(imagePaths.map((p) => imageFileToDataUrl(p)));
  const image = await generateImage({ token, accountId, prompt, triggerModel, images, signal: AbortSignal.timeout(timeoutMs) });
  const savedPath = await saveImagePng(image.base64, runDir, "image.png");
  const result = {
    schemaVersion: 1,
    runId,
    runDir,
    savedPath,
    kind: "image",
    backend: IMAGE_BACKEND,
    triggerModel,
    referenceImages: imagePaths,
    revisedPrompt: image.revisedPrompt,
    responseId: image.responseId,
    participant: { id: participant.id, kind: participant.kind },
  };
  await fs.writeFile(path.join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await recordLatestRun(cwd, { runId, runDir, participant, kind: "image" });
  if (flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    [
      `# @${participant.id}`,
      "",
      `Generated an image with **${IMAGE_BACKEND}** (via your Codex CLI login).`,
      imagePaths.length ? `Reference image(s): ${imagePaths.join(", ")}` : undefined,
      image.revisedPrompt ? `Revised prompt: ${image.revisedPrompt}` : undefined,
      `Saved: ${savedPath}`,
      "",
      "View it with the Read tool if needed.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

// Tri-state flag pair: --<name> → true, --no-<name> → false, neither → undefined.
function flagBool(flags, name) {
  if (flags[`no-${name}`] === true) return false;
  if (flags[name] === true) return true;
  return undefined;
}

const PRESET_OVERRIDE_FLAGS = ["name", "id", "cwd", "timeoutMs", "description"];
const CUSTOM_ADD_FLAGS = ["name", "id", "kind", "model", "provider", "effort", "thinking", "tools", "toolsPolicy", "skills", "skillsPolicy", "agent", "cwd", "timeoutMs", "maxTurns", "description"];
const CUSTOM_SHAPE_FLAGS = ["kind", "model", "provider", "effort", "thinking", "tools", "toolsPolicy", "skills", "skillsPolicy", "agent", "maxTurns"];

function assertAllowedFlags(flags, allowed, context) {
  const allowedSet = new Set(allowed);
  const rejected = Object.keys(flags).filter((flag) => !allowedSet.has(flag));
  if (rejected.length > 0) {
    throw new Error(`Unsupported ${context} option(s): ${rejected.map((flag) => `--${flag}`).join(", ")}. Allowed: ${allowed.map((flag) => `--${flag}`).join(", ")}.`);
  }
}

function hasCustomShape(flags) {
  return CUSTOM_SHAPE_FLAGS.some((flag) => stringFlag(flags[flag]) !== undefined);
}

function stringFlag(value) {
  if (value === undefined || value === null || value === true) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function presetOverrides(flags) {
  return { name: flags.name, id: flags.id, cwd: flags.cwd, timeoutMs: flags.timeoutMs, description: flags.description };
}

function customParticipantInput(name, flags) {
  return {
    name,
    id: flags.id,
    kind: flags.kind,
    model: flags.model,
    provider: flags.provider,
    effort: flags.effort,
    thinking: flags.thinking,
    toolsPolicy: flags.tools ?? flags.toolsPolicy,
    skillsPolicy: flags.skills ?? flags.skillsPolicy,
    agent: flags.agent,
    cwd: flags.cwd,
    timeoutMs: flags.timeoutMs,
    maxTurns: flags.maxTurns,
    description: flags.description,
  };
}

function addUsage() {
  return [
    "Usage:",
    "  /consensflow:participants add <preset> [--name <name>]   # from a preset, optionally renamed",
    "  /consensflow:participants add all                         # every preset",
    "  /consensflow:participants add --name <name> --kind <pi|claude-code|codex|opencode|image> --model <model> [--effort <e>] [--thinking <t>] [--tools <workspace-write|full-auto>] [--cwd <subdir>]",
    "",
    `Presets: ${listPresetIds().join(", ")}`,
  ].join("\n");
}

function formatParticipants(participants, cwd = process.cwd()) {
  if (participants.length === 0) {
    return [
      "# ConsensFlow participants",
      "",
      `Participants file: ${participantsPath(cwd)}`,
      "",
      "No participants configured yet.",
      "",
      "Create participants:",
      "```text",
      "/consensflow:presets                                    # list the curated presets",
      "/consensflow:participants add zeus                      # add a preset",
      "/consensflow:participants add zeus --name Deepreview    # preset backend, custom name",
      "/consensflow:participants add all                       # every preset",
      "/consensflow:participants add --name Builder --kind codex --model gpt-5.5 --tools workspace-write",
      "```",
    ].join("\n");
  }
  return ["# ConsensFlow participants", "", `Participants file: ${participantsPath(cwd)}`, "", ...participants.map(formatParticipantLine)].join("\n");
}

function formatParticipantLine(p) {
  const model = p.model ? ` model=${p.model}` : "";
  const effort = p.effort ? ` effort=${p.effort}` : p.thinking ? ` thinking=${p.thinking}` : "";
  const cwd = p.cwd ? ` cwd=${p.cwd}` : "";
  const skills = p.kind === "pi" ? ` skills=${p.skillsPolicy ?? "default"}` : "";
  const preset = p.preset ? ` preset=${p.preset}` : "";
  // Safe mode is the quiet/default display. Only surface persistent write-capable roster entries;
  // per-call --rw / --tools overrides remain explicit at run time.
  const policy = effectiveToolsPolicy(p);
  const access = policy === "readonly" ? "" : ` access=${policy}`;
  const head = `- @${p.id} (${p.kind}${model}${effort}${cwd}${skills}${preset})${access}`;
  return p.description ? `${head}\n    ${p.description}` : head;
}

// Just the answer on a clean default safe-mode run. Diagnostics appear only when they matter: the run
// failed, the handoff was unexpectedly empty, or the participant could have written to the
// workspace. Full metadata stays in result.json (and `--json`).
function renderRunResult(result) {
  const writeCapable = effectiveToolsPolicy(result.participant) !== "readonly";
  const lines = [`# @${result.participant.id}`];
  if (result.timedOut) {
    // A timeout is not a failure with a meaningful exit code — the partial trail below is the
    // real signal. Don't print "exit 0", which reads as success.
    lines.push("", `(timed out — partial output below; artifacts: ${result.runDir})`);
  } else if (result.exitCode !== 0) {
    lines.push("", `Run failed: exit ${result.exitCode} — artifacts: ${result.runDir}`);
  }
  if (result.handoffSummary?.startsWith("empty")) lines.push("", `Handoff: ${result.handoffSummary}`);
  if (writeCapable) lines.push("", "> Write-capable run: this participant could edit files and run commands. Inspect what changed in the workspace (e.g. `git status` / `git diff` in a repo) and review it before keeping or building on it.");
  lines.push("", result.output);
  return lines.join("\n");
}

function helpText() {
  return `# ConsensFlow help

Ask one named participant at a time. Each participant gets the current session as a handoff
plus your prompt, and answers conversationally.

Ask a participant:

\`\`\`text
@zeus What do you think about this approach?       # mention it in your prompt — the plugin routes it
/consensflow:cf @zeus What do you think?           # explicit slash command
\`\`\`

Manage participants (shared across Claude Code and Pi, ${participantsPath(process.cwd())}):

\`\`\`text
/consensflow:presets                                    # list the curated presets
/consensflow:participants                               # list configured participants
/consensflow:participants add zeus                      # add a preset
/consensflow:participants add zeus --name Deepreview    # preset backend, your own name
/consensflow:participants add all                       # every preset
/consensflow:participants add --name Builder --kind codex --model gpt-5.5 --effort high \\
    --tools workspace-write                             # fully custom, write-capable
/consensflow:participants show @zeus
/consensflow:participants remove @zeus
/consensflow:status                                     # roster + latest run
/consensflow:doctor                                     # engine CLI health check
\`\`\`

For the lead (via the Bash tool), the CLI subcommands are \`status\` | \`doctor\` |
\`participants list|presets|add|show|remove\` | \`run @name <prompt>\`, with run flags
\`--stream\` | \`--rw\` | \`--tools workspace-write|full-auto\` | \`--prompt <text>\` |
\`--prompt-file <file>\` | \`--context <note>\` | \`--no-handoff\` | \`--timeout-ms <ms>\` | \`--image <path>\` (image participants) | \`--json\`.

Rules:

- Send to one participant at a time.
- Participants use default safe mode (no write tools) unless you explicitly configure \`--tools workspace-write\` or
  \`full-auto\` (a write-capable participant can edit files and run commands).
- One-shot: participants do not remember previous calls; each call re-sends the current session handoff.
- The current Claude Code session remains the lead and decides what to implement.
`;
}

// Run only when invoked as the CLI entry point, so tests can import the pure helpers above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`ConsensFlow error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

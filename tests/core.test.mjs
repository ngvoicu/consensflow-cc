import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPacket } from "../lib/packets.js";
import { getPreset, listPresetIds, PARTICIPANT_PRESETS, participantFromPreset } from "../lib/presets.js";
import { buildRunnerInvocation, codexSandbox, effectiveTimeoutMs, normalizeProcessOutput, runParticipant, spawnWithInput, toolsForPi } from "../lib/runners.js";
import { getParticipant, loadParticipants, normalizeParticipant, removeParticipant, upsertParticipant } from "../lib/state.js";
import { effectiveToolsPolicy, participantForKind } from "../lib/workflows.js";
import { parseOptions, parseParticipantPrompt, resolveInside, slugify, tokenize } from "../lib/utils.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cf-cc-test-"));
  const oldHome = process.env.CONSENSFLOW_HOME;
  process.env.CONSENSFLOW_HOME = path.join(dir, "home", ".consensflow");
  try {
    return await fn(dir);
  } finally {
    if (oldHome === undefined) delete process.env.CONSENSFLOW_HOME;
    else process.env.CONSENSFLOW_HOME = oldHome;
    await rm(dir, { recursive: true, force: true });
  }
}

test("tokenize handles quotes and parseOptions handles flags", () => {
  assert.deepEqual(tokenize('add "Zeus Opus" --kind claude-code --model claude-opus-4-7'), [
    "add",
    "Zeus Opus",
    "--kind",
    "claude-code",
    "--model",
    "claude-opus-4-7",
  ]);
  assert.deepEqual(parseOptions(["Athena", "--kind=codex", "--model", "gpt-5.5"]).flags, {
    kind: "codex",
    model: "gpt-5.5",
  });
  // `--no-*` negation flags are always boolean — they must never swallow the next token
  // (this is how `run @zeus --no-handoff <prompt>` used to eat the prompt).
  assert.deepEqual(parseOptions(["@zeus", "--no-handoff", "what", "about", "this?"]), {
    positional: ["@zeus", "what", "about", "this?"],
    flags: { "no-handoff": true },
  });
});

test("slugify creates stable mentions", () => {
  assert.equal(slugify("Zeus Opus 4.7"), "zeus-opus-4-7");
  assert.equal(slugify(" Isis  "), "isis");
});

test("participant CRUD persists global user-level JSON", async () => {
  await withTempDir(async (cwd) => {
    const athena = await upsertParticipant(cwd, {
      name: "Athena",
      kind: "codex",
      model: "gpt-5.5",
      effort: "xhigh",
      toolsPolicy: "workspace-write",
    });
    assert.equal(athena.id, "athena");
    assert.equal((await getParticipant(cwd, "@athena")).model, "gpt-5.5");
    assert.equal((await loadParticipants(cwd)).length, 1);
    assert.equal(await removeParticipant(cwd, "athena"), true);
    assert.equal((await loadParticipants(cwd)).length, 0);
  });
});

test("createPacket is conversational, mode-aware, and carries handoff + diff", async () => {
  await withTempDir(async (cwd) => {
    const participant = await upsertParticipant(cwd, {
      name: "Zeus",
      kind: "pi",
      model: "openrouter/anthropic/claude-opus-4.7",
      toolsPolicy: "readonly",
    });
    const packet = await createPacket({
      cwd,
      participant,
      kind: "ask",
      task: "Review the latest changes",
      handoff: "User:\nhi\n\nLead:\nworking on the packet",
    });
    assert.match(packet, /## Message from the user/);
    assert.match(packet, /Review the latest changes/);
    assert.match(packet, /Read-only: you can inspect the workspace/);
    assert.match(packet, /## Handoff — current session/);
    assert.match(packet, /working on the packet/);
  });
});

test("createPacket gives write-capable participants a read-write mode line", async () => {
  await withTempDir(async (cwd) => {
    const participant = await upsertParticipant(cwd, {
      name: "Builder",
      kind: "claude-code",
      toolsPolicy: "workspace-write",
    });
    const packet = await createPacket({ cwd, participant, kind: "ask", task: "add a health check endpoint" });
    assert.match(packet, /Read-write: you can read and modify this workspace/);
    assert.doesNotMatch(packet, /Read-only:/);
  });
});

test("participant presets mirror consensflow-pi exactly (image preset included)", () => {
  assert.deepEqual(listPresetIds(), [
    "calliope", "clio", "euterpe", "thalia",
    "zeus", "apollo", "artemis", "athena", "perseus", "iris", "hermes", "eos", "luna",
    "orpheus", "linus", "erato", "saga", "gunnlod", "kvasir",
    "kronos", "atlas", "baldr", "vali", "forseti", "bragi", "ullr",
    "hermod", "loki", "nike", "freya", "zephyros", "sif",
    "hades", "helios", "ares", "hephaestus", "pan", "aeolus", "metis",
    "odin", "heimdall", "thor", "tyr", "vidar", "njord", "mimir",
    "pygmalion",
  ]);
  // All four engines are integrated, same as consensflow-pi — plus the Codex-backend image kind.
  const kinds = new Set(PARTICIPANT_PRESETS.map((preset) => preset.kind));
  assert.deepEqual([...kinds].sort(), ["claude-code", "codex", "image", "opencode", "pi"]);
  assert.equal(getPreset("pygmalion").kind, "image");
  assert.equal(getPreset("zeus").kind, "claude-code");
  assert.equal(getPreset("athena").model, "gpt-5.5");
  assert.equal(getPreset("iris").thinking, "xhigh");
  // The frontier matrix: same model+effort family on every engine that runs it.
  assert.equal(getPreset("artemis").effort, "medium");
  assert.equal(getPreset("perseus").effort, "high");
  assert.equal(getPreset("kronos").model, "anthropic/claude-opus-4-8");
  assert.equal(getPreset("baldr").model, "openrouter/anthropic/claude-opus-4.8");
  assert.equal(getPreset("forseti").model, "openrouter/openai/gpt-5.5");
  // Effort vocabularies are engine-real: "max" exists only on claude-code; OpenRouter tops out
  // at xhigh, and models without catalog variants (e.g. Kimi K2.6) carry no effort at all.
  assert.equal(getPreset("baldr").effort, "xhigh");
  assert.equal(getPreset("luna").effort, undefined);
  assert.equal(getPreset("heimdall").effort, "high");
  assert.equal(getPreset("sif").effort, "low");
  // Fable 5 family follows the same rules: claude-code gets max, the rest cap at xhigh.
  assert.equal(getPreset("calliope").effort, "max");
  assert.equal(getPreset("calliope").model, "claude-fable-5");
  assert.equal(getPreset("orpheus").model, "anthropic/claude-fable-5");
  assert.equal(getPreset("saga").model, "openrouter/anthropic/claude-fable-5");
  assert.equal(getPreset("saga").effort, "xhigh");
  assert.equal(getPreset("euterpe").effort, "high");
  assert.equal(getPreset("linus").thinking, "high");
  assert.equal(getPreset("gunnlod").effort, "high");
  const luna = participantFromPreset("luna", { cwd: "frontend", timeoutMs: 1234 });
  assert.equal(luna.id, "luna");
  assert.equal(luna.name, "Luna");
  assert.equal(luna.cwd, "frontend");
  assert.equal(luna.timeoutMs, 1234);
  assert.equal(participantFromPreset("custom"), null);
});

test("every preset survives normalize + runner invocation with correct flags (all models × all engines)", () => {
  const KIND_COMMAND = { pi: "pi", "claude-code": "claude", codex: "codex", opencode: "opencode" };
  for (const preset of PARTICIPANT_PRESETS) {
    const participant = normalizeParticipant(participantFromPreset(preset.preset));
    assert.equal(participant.id, preset.id, `${preset.preset}: id survives the pipeline`);
    assert.equal(participant.kind, preset.kind, `${preset.preset}: kind`);
    assert.equal(participant.model, preset.model, `${preset.preset}: model`);
    assert.equal(effectiveToolsPolicy(participant), "readonly", `${preset.preset}: presets are readonly`);

    if (preset.kind === "image") {
      assert.throws(() => buildRunnerInvocation(participant, "/tmp/packet.md", "/repo"), /image participants/);
      continue;
    }
    const invocation = buildRunnerInvocation(participant, "/tmp/packet.md", "/repo");
    assert.equal(invocation.command, KIND_COMMAND[preset.kind], `${preset.preset}: engine command`);
    assert.equal(invocation.env?.CONSENSFLOW_CHILD, "1", `${preset.preset}: child marker env`);
    const modelIdx = invocation.args.indexOf(preset.model);
    assert.ok(modelIdx > 0, `${preset.preset}: model reaches the args`);
    assert.equal(invocation.args[modelIdx - 1], "--model", `${preset.preset}: model flag`);

    if (preset.kind === "claude-code") {
      assert.equal(invocation.args[invocation.args.indexOf("--effort") + 1], preset.effort, `${preset.preset}: claude effort`);
      assert.ok(invocation.args.includes("--disallowedTools"), `${preset.preset}: claude readonly deny list`);
      assert.ok(invocation.args.includes("--bare"), `${preset.preset}: claude children skip plugin/hook discovery`);
    }
    if (preset.kind === "codex") {
      assert.ok(invocation.args.includes(`model_reasoning_effort=\"${preset.effort}\"`), `${preset.preset}: codex effort`);
      assert.ok(invocation.args.includes("read-only"), `${preset.preset}: codex sandbox`);
    }
    if (preset.kind === "opencode") {
      if (preset.effort) assert.equal(invocation.args[invocation.args.indexOf("--variant") + 1], preset.effort, `${preset.preset}: opencode variant`);
      else assert.equal(invocation.args.includes("--variant"), false, `${preset.preset}: no catalog variant → no flag`);
      assert.ok(invocation.env?.OPENCODE_PERMISSION, `${preset.preset}: opencode readonly permission env`);
    }
    if (preset.kind === "pi") {
      assert.equal(invocation.args[invocation.args.indexOf("--thinking") + 1], preset.thinking ?? "off", `${preset.preset}: pi thinking`);
      assert.equal(invocation.args[invocation.args.indexOf("--tools") + 1], "read,grep,find,ls", `${preset.preset}: pi readonly tools`);
    }
  }
});

test("runner invocation maps tool policies", () => {
  assert.equal(toolsForPi("readonly"), "read,grep,find,ls");
  assert.equal(codexSandbox("workspace-write"), "workspace-write");
  const pi = buildRunnerInvocation({ kind: "pi", model: "openrouter/moonshotai/kimi-k2.6", toolsPolicy: "readonly", skillsPolicy: "default" }, "/tmp/packet.md", "/repo");
  assert.equal(pi.command, "pi");
  assert.deepEqual(pi.args.slice(0, 6), ["--mode", "json", "--no-session", "--no-extensions", "--model", "openrouter/moonshotai/kimi-k2.6"]);
  assert.ok(pi.args.includes("off"));
  assert.equal(pi.args.includes("--no-skills"), false);
  const sterilePi = buildRunnerInvocation({ kind: "pi", toolsPolicy: "readonly", skillsPolicy: "none" }, "/tmp/packet.md", "/repo");
  assert.ok(sterilePi.args.includes("--no-skills"));
  const codex = buildRunnerInvocation({ kind: "codex", model: "gpt-5.5", effort: "xhigh", toolsPolicy: "readonly" }, "/tmp/packet.md", "/repo");
  assert.equal(codex.command, "codex");
  assert.ok(codex.args.includes("read-only"));
  assert.ok(codex.args.includes("--ephemeral"));
  assert.ok(codex.args.includes("--skip-git-repo-check"));
  assert.ok(codex.args.includes("--ignore-user-config"));
  assert.ok(codex.args.includes("--ignore-rules"));
  assert.ok(codex.args.includes("model_reasoning_effort=\"xhigh\""));
});

test("readonly enforcement reaches every engine: claude allow+deny lists, opencode permission env", () => {
  // Claude readonly: explorers allowed, write tools explicitly denied (a user-level Bash
  // allowlist must not leak write capability into a read-only reviewer).
  const claude = buildRunnerInvocation({ kind: "claude-code", toolsPolicy: "readonly" }, "/tmp/packet.md", "/repo");
  assert.ok(claude.args.includes("Read,Grep,Glob"));
  const denyIndex = claude.args.indexOf("--disallowedTools");
  assert.ok(denyIndex >= 0);
  assert.match(claude.args[denyIndex + 1], /Bash/);
  assert.match(claude.args[denyIndex + 1], /Edit/);
  assert.match(claude.args[denyIndex + 1], /Write/);
  // The CC-specific recursion/stomp guard: claude children skip plugin/hook/skill discovery.
  assert.ok(claude.args.includes("--bare"));
  assert.ok(claude.args.includes("--no-session-persistence"));
  const claudeWrite = buildRunnerInvocation({ kind: "claude-code", toolsPolicy: "workspace-write" }, "/tmp/packet.md", "/repo");
  assert.equal(claudeWrite.args.includes("--disallowedTools"), false);
  assert.ok(claudeWrite.args.some((arg) => arg.includes("Edit") && arg.includes("Bash")));

  // OpenCode defaults to edit/bash "allow"; readonly must override via OPENCODE_PERMISSION.
  const opencode = buildRunnerInvocation({ kind: "opencode", toolsPolicy: "readonly" }, "/tmp/packet.md", "/repo");
  assert.deepEqual(JSON.parse(opencode.env.OPENCODE_PERMISSION), { edit: "deny", bash: "deny" });
  const opencodeWrite = buildRunnerInvocation({ kind: "opencode", toolsPolicy: "workspace-write" }, "/tmp/packet.md", "/repo");
  assert.equal(opencodeWrite.env?.OPENCODE_PERMISSION, undefined);

  // Every engine child carries the nesting marker.
  for (const kind of ["pi", "claude-code", "codex", "opencode"]) {
    const invocation = buildRunnerInvocation({ kind, toolsPolicy: "readonly" }, "/tmp/packet.md", "/repo");
    assert.equal(invocation.env?.CONSENSFLOW_CHILD, "1", `${kind}: CONSENSFLOW_CHILD`);
  }

  // Billing guard: participant runs ride the configured logins, not a stray env API key.
  assert.deepEqual(claude.dropEnv, ["ANTHROPIC_API_KEY"]);
  const codex = buildRunnerInvocation({ kind: "codex", toolsPolicy: "readonly" }, "/tmp/packet.md", "/repo");
  assert.deepEqual(codex.dropEnv, ["OPENAI_API_KEY"]);
});

test("image participants are valid config but never reach the CLI runner (backstop)", () => {
  // Image generation is handled upstream in cf.mjs (Codex backend); the runner must throw loudly
  // if one ever slips through to the spawn path.
  const participant = normalizeParticipant({ name: "Pygmalion", kind: "image", toolsPolicy: "readonly" });
  assert.equal(participant.kind, "image");
  assert.throws(() => buildRunnerInvocation(participant, "/tmp/packet.md", "/repo"), /Codex backend/);
});

test("spawnWithInput survives a child that exits without reading stdin (EPIPE)", async () => {
  // `true` exits immediately without consuming the 5MB packet; the stdin pipe raises EPIPE,
  // which must be captured, not thrown as an uncaughtException that kills the host.
  const result = await spawnWithInput("true", [], { input: "x".repeat(5 * 1024 * 1024), timeoutMs: 10_000 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
});

test("effectiveTimeoutMs: per-call override wins over participant config, then the default", () => {
  assert.equal(effectiveTimeoutMs({ timeoutMs: 900000 }, 1234), 1234);
  assert.equal(effectiveTimeoutMs({ timeoutMs: 900000 }, undefined), 900000);
  assert.equal(effectiveTimeoutMs({}, undefined), 10 * 60 * 1000);
});

test("toolsPolicy alone gates write access; a missing policy fails safe to readonly", () => {
  // Explicit write policies are honored as configured.
  const builder = { id: "builder", name: "Builder", kind: "claude-code", toolsPolicy: "workspace-write" };
  assert.equal(effectiveToolsPolicy(builder), "workspace-write");
  assert.equal(participantForKind(builder, "ask").toolsPolicy, "workspace-write");
  assert.equal(effectiveToolsPolicy({ id: "auto", name: "Auto", kind: "codex", toolsPolicy: "full-auto" }), "full-auto");

  // Explicit readonly stays readonly.
  assert.equal(effectiveToolsPolicy({ id: "ro", name: "RO", kind: "pi", toolsPolicy: "readonly" }), "readonly");

  // Fail safe: a missing policy is readonly, and participantForKind materializes it.
  const bare = { id: "bare", name: "Bare", kind: "codex" };
  assert.equal(effectiveToolsPolicy(bare), "readonly");
  assert.equal(participantForKind(bare, "ask").toolsPolicy, "readonly");

  // normalizeParticipant defaults an omitted policy to readonly and rejects bogus values.
  const p = normalizeParticipant({ name: "Y", kind: "codex" });
  assert.equal(p.toolsPolicy, "readonly");
  assert.throws(() => normalizeParticipant({ name: "X", kind: "codex", toolsPolicy: "bogus" }), /toolsPolicy must be one of/);
});

test("runParticipant rejects participant cwd that escapes workspace before spawning", async () => {
  await withTempDir(async (cwd) => {
    await assert.rejects(
      runParticipant({
        cwd,
        participant: { id: "bad", name: "Bad", kind: "pi", toolsPolicy: "readonly", cwd: "../outside" },
        packet: "# Packet",
        kind: "ask",
      }),
      /Path escapes workspace/,
    );
  });
});

test("normalizeProcessOutput parses Claude JSON result", () => {
  const out = normalizeProcessOutput("claude-code", JSON.stringify({ type: "result", result: "OK" }), "");
  assert.equal(out.output, "OK");
});

test("normalizeProcessOutput parses Claude JSON event array result", () => {
  const out = normalizeProcessOutput("claude-code", JSON.stringify([
    { type: "system" },
    { type: "assistant", message: { content: [{ type: "text", text: "draft" }] } },
    { type: "result", result: "CLAUDE FINAL" },
  ]), "");
  assert.equal(out.output, "CLAUDE FINAL");
});

test("normalizeProcessOutput parses Codex JSONL agent message text", () => {
  const stdout = [
    JSON.stringify({ type: "thread.started", thread_id: "t" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "draft" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "CODEX FINAL" } }),
  ].join("\n");
  const out = normalizeProcessOutput("codex", stdout, "");
  assert.equal(out.output, "CODEX FINAL");
});

test("normalizeProcessOutput parses Pi JSON mode final assistant text", () => {
  const stdout = [
    JSON.stringify({ type: "session", id: "s" }),
    JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "PI OK" }] } }),
    JSON.stringify({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "PI FINAL" }] }] }),
  ].join("\n");
  const out = normalizeProcessOutput("pi", stdout, "");
  assert.equal(out.output, "PI FINAL");
});

test("normalizeProcessOutput parses Pi JSON mode from a truncated tail", () => {
  const stdout = [
    "[truncated: kept tail]",
    JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ignored" } }),
    JSON.stringify({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "TAIL FINAL" }] }] }),
  ].join("\n");
  const out = normalizeProcessOutput("pi", stdout, "");
  assert.equal(out.output, "TAIL FINAL");
});

test("normalizeProcessOutput parses OpenCode JSON text events", () => {
  const stdout = [
    JSON.stringify({ type: "step", part: { text: "working" } }),
    JSON.stringify({ text: "OPENCODE FINAL" }),
  ].join("\n");
  const out = normalizeProcessOutput("opencode", stdout, "");
  assert.equal(out.output, "OPENCODE FINAL");
});

test("participantFromPreset can rename while keeping the backend", () => {
  const renamed = participantFromPreset("zeus", { name: "Deepreview" });
  assert.equal(renamed.id, "deepreview");
  assert.equal(renamed.name, "Deepreview");
  assert.equal(renamed.kind, "claude-code");
  assert.equal(renamed.model, "claude-opus-4-8");
  assert.equal(renamed.preset, "zeus");
  // Without a rename, the canonical preset id and name are kept.
  const luna = participantFromPreset("luna");
  assert.equal(luna.id, "luna");
  assert.equal(luna.name, "Luna");
});

test("parseParticipantPrompt routes one mention anywhere, and never hijacks stray @tokens", () => {
  const known = new Set(["zeus", "athena"]);
  // Leading and trailing single mention are equivalent.
  assert.deepEqual(parseParticipantPrompt(["@zeus", "hi"], known), { participant: "zeus", prompt: "hi" });
  assert.deepEqual(parseParticipantPrompt(["hi", "@zeus"], known), { participant: "zeus", prompt: "hi" });
  assert.deepEqual(parseParticipantPrompt(["summarize", "@zeus", "please"], known), { participant: "zeus", prompt: "summarize please" });
  // "ask"/"to" verb prefix still addresses a leading participant.
  assert.deepEqual(parseParticipantPrompt(["ask", "@athena", "review"], known), { participant: "athena", prompt: "review" });
  // A leading mention wins and later @names stay as quoted text (paste-prior-output intact).
  assert.deepEqual(parseParticipantPrompt(["@athena", "agree", "with", "@zeus?"], known), { participant: "athena", prompt: "agree with @zeus?" });
  // Multiple leading mentions are rejected.
  assert.ok(parseParticipantPrompt(["@zeus", "@athena", "hi"], known)?.error);
  // A stray non-leading @token that is not a participant goes to the lead, not a subprocess.
  assert.equal(parseParticipantPrompt(["install", "@types/node", "now"], known), null);
  // Two different participants, none leading -> ambiguous, lead handles.
  assert.equal(parseParticipantPrompt(["compare", "@zeus", "and", "@athena"], known), null);
  // No mention at all.
  assert.equal(parseParticipantPrompt(["just", "fix", "the", "bug"], known), null);
  // Leading mention without a prompt errors helpfully.
  assert.ok(parseParticipantPrompt(["@zeus"], known)?.error);
  // Without a known-set, a non-leading mention does not route (conservative default).
  assert.equal(parseParticipantPrompt(["hi", "@zeus"]), null);
});

test("resolveInside rejects symlinked escapes, not just lexical ../ ones", async () => {
  await withTempDir(async (dir) => {
    const ws = path.join(dir, "ws");
    const outside = path.join(dir, "outside");
    await mkdir(path.join(ws, "sub"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(ws, "link"), "dir");
    assert.throws(() => resolveInside(ws, "../outside"), /escapes workspace/);
    // ws/link points outside the workspace: lexical containment passes, realpath must not.
    assert.throws(() => resolveInside(ws, "link"), /escapes workspace/);
    // Normal subdirs — existing or not-yet-created — still resolve.
    assert.ok(resolveInside(ws, "sub"));
    assert.ok(resolveInside(ws, "brand-new/dir"));
  });
});

test("upsertParticipant rejects a name slug that collides with another participant's id", async () => {
  await withTempDir(async (dir) => {
    await upsertParticipant(dir, { name: "Zeus", kind: "claude-code", model: "claude-opus-4-8" });
    await upsertParticipant(dir, { name: "Athena", kind: "codex", model: "gpt-5.5" });
    // getParticipant resolves by id OR name slug, so a second participant whose NAME slugifies
    // to an existing id would shadow it — must be rejected, not silently saved.
    await assert.rejects(upsertParticipant(dir, { id: "athena2", name: "Zeus", kind: "codex", model: "gpt-5.5" }), /collides/);
    // Updating the same participant in place stays allowed.
    await upsertParticipant(dir, { name: "Zeus", kind: "claude-code", model: "claude-opus-4-8", effort: "max" });
  });
});

// lib parity with the consensflow-pi sibling: these files are kept byte-identical by convention
// (see AGENTS.md). A divergence means a fix landed in one project and silently missed the other.
test("parity: shared lib files stay identical with the consensflow-pi sibling", async (t) => {
  const siblingLib = new URL("../../consensflow-pi/extensions/consensflow/lib/", import.meta.url);
  for (const file of ["utils.js", "workflows.js"]) {
    let sibling;
    try {
      sibling = await readFile(new URL(file, siblingLib), "utf8");
    } catch {
      t.skip("consensflow-pi sibling checkout not present");
      return;
    }
    const ours = await readFile(new URL(`../lib/${file}`, import.meta.url), "utf8");
    assert.equal(ours, sibling, `${file} diverged from consensflow-pi — change both or document the delta in both AGENTS.md files`);
  }
});


import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nowIso, slugify, stripMention } from "./utils.js";

// "image" is a backend-based kind (Codex Responses → gpt-image-2 via the Codex CLI login), not a
// CLI runner: it is handled upstream in cf.mjs, and buildRunnerInvocation keeps a loud backstop.
export const PARTICIPANT_KINDS = ["pi", "claude-code", "codex", "opencode", "image"];
export const ROLE_VALUES = ["lead", "spec-creator", "reviewer", "implementer", "council", "knowledge"];
export const TOOL_POLICIES = ["readonly", "workspace-write", "full-auto"];
export const SKILLS_POLICIES = ["default", "none", "explicit"];

// Per-tool participant store: consensflow-cc and the Pi sibling keep separate rosters under the
// shared config home — ~/.consensflow/consensflow-cc/ here. CONSENSFLOW_HOME overrides the parent
// home (tests point it at a temp dir).
export function configRoot() {
  return path.join(process.env.CONSENSFLOW_HOME || path.join(os.homedir(), ".consensflow"), "consensflow-cc");
}

export function cfRoot(cwd) {
  return path.join(cwd, ".consensflow");
}

export function participantsPath(_cwd) {
  return path.join(configRoot(), "participants.json");
}

export function currentPath(cwd) {
  return path.join(cfRoot(cwd), "current.json");
}

export function runsRoot(cwd) {
  return path.join(cfRoot(cwd), "runs");
}

// Per-workspace stash of the live Claude Code session (transcript path etc.), maintained by the
// plugin hooks so cf.mjs can build a handoff — Bash subprocesses get no session env from the host.
export function sessionPath(cwd) {
  return path.join(cfRoot(cwd), "session.json");
}

export async function ensureCfDirs(cwd) {
  await fs.mkdir(configRoot(), { recursive: true });
  await fs.mkdir(cfRoot(cwd), { recursive: true });
  await fs.mkdir(runsRoot(cwd), { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export async function loadParticipantsFile(cwd) {
  const file = await readJson(participantsPath(cwd), { schemaVersion: 1, participants: [] });
  if (!Array.isArray(file.participants)) file.participants = [];
  return file;
}

export async function saveParticipantsFile(cwd, file) {
  const normalized = {
    schemaVersion: 1,
    participants: file.participants.map((participant) => normalizeParticipant(participant)),
  };
  assertUniqueParticipants(normalized.participants);
  await writeJsonAtomic(participantsPath(cwd), normalized);
  return normalized;
}

export async function loadParticipants(cwd) {
  return (await loadParticipantsFile(cwd)).participants;
}

export async function getParticipant(cwd, ref) {
  const id = slugify(stripMention(ref));
  const participants = await loadParticipants(cwd);
  return participants.find((participant) => participant.id === id || slugify(participant.name) === id) ?? null;
}

export async function upsertParticipant(cwd, input) {
  const file = await loadParticipantsFile(cwd);
  const now = nowIso();
  const participant = normalizeParticipant({ ...input, updatedAt: now, createdAt: input.createdAt ?? now });
  const index = file.participants.findIndex((entry) => entry.id === participant.id);
  if (index >= 0) {
    participant.createdAt = file.participants[index].createdAt ?? participant.createdAt;
    file.participants[index] = participant;
  } else {
    file.participants.push(participant);
  }
  await saveParticipantsFile(cwd, file);
  return participant;
}

export async function removeParticipant(cwd, ref) {
  const id = slugify(stripMention(ref));
  const file = await loadParticipantsFile(cwd);
  const before = file.participants.length;
  file.participants = file.participants.filter((participant) => participant.id !== id && slugify(participant.name) !== id);
  await saveParticipantsFile(cwd, file);
  return before !== file.participants.length;
}

export function normalizeParticipant(input) {
  const name = String(input.name ?? input.id ?? "").trim();
  if (!name) throw new Error("Participant name is required");
  const id = slugify(input.id ?? name);
  const kind = String(input.kind ?? "pi");
  if (!PARTICIPANT_KINDS.includes(kind)) {
    throw new Error(`Unsupported participant kind '${kind}'. Expected one of: ${PARTICIPANT_KINDS.join(", ")}`);
  }

  const requestedRoles = normalizeList(input.roles, defaultRolesForKind(kind));
  const roles = requestedRoles.filter((role) => ROLE_VALUES.includes(role));
  // A non-empty roles input that filters down to nothing is all-invalid: fail loudly rather than
  // silently yield roles=[]. An empty roles set bypasses the advisory->readonly coercion in
  // effectiveToolsPolicy, so `--roles bogus --tools workspace-write` would otherwise produce a
  // misconfigured, unexpectedly write-capable participant. Omitted roles fall back to a valid
  // default above, so this only fires on genuinely bad input.
  if (requestedRoles.length > 0 && roles.length === 0) {
    throw new Error(`roles must be one or more of: ${ROLE_VALUES.join(", ")}`);
  }
  const toolsPolicy = normalizeEnum(input.toolsPolicy ?? input.tools ?? input.toolPolicy, TOOL_POLICIES, "readonly", "toolsPolicy");
  const skillsPolicy = normalizeEnum(input.skillsPolicy ?? input.skills, SKILLS_POLICIES, "default", "skillsPolicy");

  const participant = {
    id,
    name,
    kind,
    roles,
    toolsPolicy,
    skillsPolicy,
    createdAt: input.createdAt ?? nowIso(),
    updatedAt: input.updatedAt ?? nowIso(),
  };

  for (const key of ["model", "provider", "effort", "thinking", "agent", "cwd", "description", "preset"]) {
    if (input[key] !== undefined && input[key] !== true && String(input[key]).trim()) {
      participant[key] = String(input[key]).trim();
    }
  }

  const skillPaths = normalizeList(input.skillPaths ?? input.skillPath, []);
  if (skillPaths.length > 0) participant.skillPaths = skillPaths;

  if (input.maxTurns !== undefined) participant.maxTurns = Number(input.maxTurns);
  if (input.timeoutMs !== undefined) participant.timeoutMs = Number(input.timeoutMs);
  return participant;
}

function normalizeList(value, fallback) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [...fallback];
}

function normalizeEnum(value, allowed, fallback, label) {
  const normalized = String(value ?? fallback).trim();
  if (!allowed.includes(normalized)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}`);
  }
  return normalized;
}

function defaultRolesForKind(_kind) {
  return ["reviewer"];
}

function assertUniqueParticipants(participants) {
  const seen = new Set();
  for (const participant of participants) {
    if (seen.has(participant.id)) throw new Error(`Duplicate participant id: ${participant.id}`);
    seen.add(participant.id);
  }
}

export async function loadCurrent(cwd) {
  return await readJson(currentPath(cwd), { schemaVersion: 1, latestRunId: undefined });
}

export async function saveCurrent(cwd, patch) {
  const current = await loadCurrent(cwd);
  const next = { ...current, ...patch, schemaVersion: 1, updatedAt: nowIso() };
  await writeJsonAtomic(currentPath(cwd), next);
  return next;
}

export async function recordLatestRun(cwd, result) {
  await saveCurrent(cwd, {
    latestRunId: result.runId,
    latestRunDir: result.runDir,
    latestParticipantId: result.participant?.id,
    latestKind: result.kind,
  });
}

export async function loadSession(cwd) {
  return await readJson(sessionPath(cwd), { schemaVersion: 1 });
}

export async function saveSession(cwd, patch) {
  const session = await loadSession(cwd);
  const next = { ...session, ...patch, schemaVersion: 1, updatedAt: nowIso() };
  await writeJsonAtomic(sessionPath(cwd), next);
  return next;
}

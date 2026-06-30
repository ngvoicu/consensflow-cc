import crypto from "node:crypto";
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nowIso, slugify, stripMention } from "./utils.js";

// "image" is a backend-based kind (Codex Responses → gpt-image-2 via the Codex CLI login), not a
// CLI runner: it is handled upstream in cf.mjs, and buildRunnerInvocation keeps a loud backstop.
export const PARTICIPANT_KINDS = ["pi", "claude-code", "codex", "opencode", "image"];
export const TOOL_POLICIES = ["workspace-write", "full-auto"];
export const SKILLS_POLICIES = ["default", "none", "explicit"];

// Older builds kept per-tool rosters below the shared home. Keep a one-time migration path so
// those users do not appear to lose participants when upgrading to the shared roster.
const LEGACY_PARTICIPANT_DIRS = ["consensflow-cc", "consensflow-pi"];

// Config home shared by both host tools (~/.consensflow; CONSENSFLOW_HOME overrides it — tests
// point it at a temp dir). Participant config and run artifacts all live directly under this
// home; there are no per-tool config roots.
export function configHome() {
  return process.env.CONSENSFLOW_HOME || path.join(os.homedir(), ".consensflow");
}

export function configRoot() {
  return configHome();
}

// Workspace artifacts (runs, session stash, pending prompt) live under the config home too,
// keyed by workspace path — ConsensFlow never creates a directory inside the project itself.
export function workspaceKey(cwd) {
  let resolved = path.resolve(cwd);
  // Canonicalize symlinks (e.g. /var vs /private/var on macOS) so every spelling of the same
  // workspace maps to one key, no matter which process computes it.
  try {
    resolved = realpathSync(resolved);
  } catch {}
  const hash = crypto.createHash("sha256").update(resolved).digest("hex").slice(0, 8);
  return `${slugify(path.basename(resolved)) || "workspace"}-${hash}`;
}

export function cfRoot(cwd) {
  return path.join(configRoot(), "workspaces", workspaceKey(cwd));
}

// Shared across both host tools so participants are defined once and usable from either.
export function participantsPath(_cwd) {
  return path.join(configHome(), "participants.json");
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

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readJson(filePath, fallback) {
  const value = await readJsonIfExists(filePath);
  return value === undefined ? fallback : value;
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export async function loadParticipantsFile(cwd) {
  const file = await readJsonIfExists(participantsPath(cwd));
  if (file !== undefined) return normalizeParticipantsFileShape(file);
  const migrated = await migrateLegacyParticipantsFile(cwd);
  return migrated ?? { schemaVersion: 1, participants: [] };
}

function normalizeParticipantsFileShape(file) {
  if (!file || typeof file !== "object" || Array.isArray(file)) return { schemaVersion: 1, participants: [] };
  if (!Array.isArray(file.participants)) file.participants = [];
  return file;
}

function legacyParticipantsPaths() {
  return LEGACY_PARTICIPANT_DIRS.map((dir) => path.join(configHome(), dir, "participants.json"));
}

async function migrateLegacyParticipantsFile(cwd) {
  const participants = [];
  for (const filePath of legacyParticipantsPaths()) {
    const legacy = await readJsonIfExists(filePath);
    if (legacy && Array.isArray(legacy.participants)) participants.push(...legacy.participants);
  }
  if (participants.length === 0) return null;

  const byId = new Map();
  for (const raw of participants) {
    const participant = normalizeParticipant(raw);
    if (!byId.has(participant.id)) byId.set(participant.id, participant);
  }
  const migrated = { schemaVersion: 1, participants: [...byId.values()] };
  assertUniqueParticipants(migrated.participants);
  await writeJsonAtomic(participantsPath(cwd), migrated);
  return migrated;
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

  const toolsPolicy = normalizeEnum(input.toolsPolicy ?? input.tools ?? input.toolPolicy, TOOL_POLICIES, "workspace-write", "toolsPolicy");
  const skillsPolicy = normalizeEnum(input.skillsPolicy ?? input.skills, SKILLS_POLICIES, "default", "skillsPolicy");

  const participant = {
    id,
    name,
    kind,
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

// getParticipant resolves @refs by id OR slugified name, so both must be unique across the
// roster — otherwise one participant's name slug could silently shadow another's id.
function assertUniqueParticipants(participants) {
  const seen = new Map();
  for (const participant of participants) {
    for (const key of new Set([participant.id, slugify(participant.name)].filter(Boolean))) {
      if (seen.has(key)) throw new Error(`Participant '@${participant.id}' collides with '@${seen.get(key)}' on '${key}': ids and slugified names must be unique.`);
      seen.set(key, participant.id);
    }
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

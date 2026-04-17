import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const DEFAULT_STATE = { version: 1, discussions: [] };

// Session IDs are emitted by scripts/session-hook.mjs as `cf-<base36>-<hex>`.
// Anything outside that shape is rejected so a hostile env var can't escape
// the state directory.
const SESSION_ID_RE = /^cf-[a-z0-9-]{1,64}$/;

/**
 * Get the state file path for a workspace.
 *
 * Layout: <dataDir>/state/<slug>-<hash>[/<sessionId>]/state.json
 *
 * When CONSENSFLOW_SESSION_ID is present and well-formed, it is appended as a
 * subdirectory so concurrent sessions against the same workspace don't
 * stomp each other's state.
 *
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function getStatePath(workspaceRoot) {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), "consensflow-cc");
  const slug = path.basename(workspaceRoot);
  const hash = crypto.createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 8);

  const parts = [dataDir, "state", `${slug}-${hash}`];

  const sessionId = process.env.CONSENSFLOW_SESSION_ID;
  if (sessionId && SESSION_ID_RE.test(sessionId)) {
    parts.push(sessionId);
  }

  parts.push("state.json");
  return path.join(...parts);
}

/**
 * Load state for a workspace. Returns default state if file missing.
 * @param {string} workspaceRoot
 * @returns {object}
 */
export function loadState(workspaceRoot) {
  const filePath = getStatePath(workspaceRoot);

  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_STATE, discussions: [] };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return { ...DEFAULT_STATE, discussions: [] };
  }
}

/**
 * Save state for a workspace.
 * @param {string} workspaceRoot
 * @param {object} state
 */
export function saveState(workspaceRoot, state) {
  const filePath = getStatePath(workspaceRoot);
  const dir = path.dirname(filePath);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}

/**
 * Add a new discussion to state.
 * @param {object} state
 * @param {string} topic
 * @param {string[]} agents
 * @returns {object} Updated state (new object)
 */
export function addDiscussion(state, topic, agents) {
  const id = `disc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const discussion = {
    id,
    topic,
    agents,
    turns: [],
    consensus: null,
    timestamp: new Date().toISOString(),
  };

  return {
    ...state,
    discussions: [...state.discussions, discussion],
  };
}

/**
 * Add a turn to an existing discussion.
 * @param {object} state
 * @param {string} discussionId
 * @param {object} turn
 * @returns {object} Updated state
 */
export function addTurn(state, discussionId, turn) {
  const disc = state.discussions.find((d) => d.id === discussionId);
  if (!disc) {
    throw new Error(`Discussion "${discussionId}" not found`);
  }

  return {
    ...state,
    discussions: state.discussions.map((d) =>
      d.id === discussionId ? { ...d, turns: [...d.turns, turn] } : d
    ),
  };
}

/**
 * Get a discussion by ID.
 * @param {object} state
 * @param {string} id
 * @returns {object|null}
 */
export function getDiscussion(state, id) {
  return state.discussions.find((d) => d.id === id) || null;
}

/**
 * Remove discussions older than maxAge milliseconds.
 * @param {object} state
 * @param {number} maxAge - Maximum age in milliseconds
 * @returns {object} Updated state
 */
export function pruneState(state, maxAge) {
  const cutoff = Date.now() - maxAge;

  return {
    ...state,
    discussions: state.discussions.filter(
      (d) => new Date(d.timestamp).getTime() > cutoff
    ),
  };
}

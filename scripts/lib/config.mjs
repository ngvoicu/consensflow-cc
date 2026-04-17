import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TEAMS_DIR = path.join(os.homedir(), ".config", "consensflow-cc", "teams");

// Team names map 1:1 to filenames inside TEAMS_DIR — restrict to a safe
// character class so a name like "../../evil" can't escape the config dir.
const TEAM_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Validate a team name is safe to use as a filename component.
 * @param {string} teamName
 * @throws If the name contains path separators or other unsafe characters
 */
export function assertSafeTeamName(teamName) {
  if (typeof teamName !== "string" || !TEAM_NAME_RE.test(teamName)) {
    throw new Error(
      `Invalid team name "${teamName}". Use letters, digits, ".", "_" or "-" (max 64 chars).`
    );
  }
}

/**
 * Load a team configuration by name.
 * @param {string} teamName
 * @returns {object} Parsed team config
 * @throws If file missing, invalid JSON, or missing required fields
 */
export function loadTeamConfig(teamName) {
  assertSafeTeamName(teamName);
  const filePath = path.join(TEAMS_DIR, `${teamName}.json`);

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Team "${teamName}" not found at ${filePath}`);
    }
    throw err;
  }

  const config = JSON.parse(raw);

  if (!config.name) {
    throw new Error(`Team config missing required field: name`);
  }
  if (!config.agents || !Array.isArray(config.agents)) {
    throw new Error(`Team config missing required field: agents (must be array)`);
  }

  return config;
}

/**
 * List all team names from the teams config directory.
 * @returns {string[]} Team names (without .json extension)
 */
export function listTeams() {
  if (!fs.existsSync(TEAMS_DIR)) {
    return [];
  }

  return fs.readdirSync(TEAMS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

/**
 * Resolve which team to use.
 * If teamName given, load that team. If omitted, auto-resolve:
 * - One team: use it
 * - Multiple teams: throw (user must specify)
 * - No teams: throw
 * @param {string} [teamName]
 * @returns {object} Parsed team config
 */
export function resolveTeam(teamName) {
  if (teamName) {
    return loadTeamConfig(teamName);
  }

  const teams = listTeams();

  if (teams.length === 0) {
    throw new Error("No teams configured. Create a team in ~/.config/consensflow-cc/teams/");
  }

  if (teams.length > 1) {
    throw new Error(
      `Multiple teams found: ${teams.join(", ")}. Specify which team to use.`
    );
  }

  return loadTeamConfig(teams[0]);
}

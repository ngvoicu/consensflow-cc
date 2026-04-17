import { checkEngine, invokeEngine, ENGINE_CONFIGS } from "./lib/engines.mjs";
import { loadTeamConfig, listTeams, resolveTeam } from "./lib/config.mjs";
import {
  loadState,
  saveState,
  addDiscussion,
  addTurn,
  getDiscussion,
} from "./lib/state.mjs";
import { interpolateTemplate, loadPromptTemplate } from "./lib/prompts.mjs";
import { parseArgs } from "./lib/args.mjs";

/**
 * Convert a timeout flag value to milliseconds.
 *
 * Accepts a bare number OR a suffixed form:
 *   "120"   → 120_000 ms (seconds, matches team-config `defaults.timeout`)
 *   "120s"  → 120_000 ms
 *   "500ms" → 500 ms
 *   "2m"    → 120_000 ms
 *
 * The un-suffixed form defaults to seconds because team-config samples
 * (and the README) use seconds. Callers that want raw milliseconds must
 * pass the "ms" suffix explicitly.
 *
 * @param {string|number|undefined} raw
 * @returns {number|undefined} milliseconds, or undefined if not provided
 */
export function normalizeTimeout(raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;

  const s = String(raw).trim().toLowerCase();
  const match = s.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!match) return undefined;

  const value = parseFloat(match[1]);
  const unit = match[2] || "s"; // bare number → seconds

  if (unit === "ms") return Math.round(value);
  if (unit === "s") return Math.round(value * 1000);
  if (unit === "m") return Math.round(value * 60_000);
  return undefined;
}

/**
 * Handle a parsed command. Main dispatcher.
 * @param {{ subcommand: string|null, flags: object, positional: string[] }} parsed
 * @returns {object} JSON-serializable result
 */
export function handleCommand(parsed) {
  const { subcommand, flags, positional } = parsed;

  switch (subcommand) {
    case "setup":
      return handleSetup(flags);
    case "invoke":
      return handleInvoke(flags, positional);
    case "check":
      return handleCheck(flags);
    case "team":
      return handleTeam(flags, positional);
    case "state":
      return handleState(flags, positional);
    case "delegate":
      return handleDelegate(flags, positional);
    case "prompt":
      return handlePrompt(flags, positional);
    default:
      return {
        error: subcommand
          ? `Unknown subcommand: ${subcommand}`
          : "No subcommand provided. Use: setup, invoke, check, team, state, delegate, prompt",
      };
  }
}

function handleSetup(flags) {
  const engines = [];
  for (const name of Object.keys(ENGINE_CONFIGS)) {
    engines.push(checkEngine(name));
  }
  return { engines };
}

function handleInvoke(flags, positional) {
  const { agent, engine, model } = flags;
  const prompt = positional.join(" ");

  if (!engine || !model) {
    return { error: "Missing required flags: --engine and --model" };
  }

  const result = invokeEngine(engine, model, prompt, {
    timeout: normalizeTimeout(flags.timeout),
  });

  if (result) {
    result.agent = agent || null;
  }

  return result || { status: "native", engine: "claude", agent };
}

function handleCheck(flags) {
  const { engine } = flags;
  if (!engine) {
    return { error: "Missing required flag: --engine" };
  }
  return checkEngine(engine);
}

function handleTeam(flags, positional) {
  const action = positional[0] || "list";

  if (action === "list") {
    return { teams: listTeams() };
  }

  if (action === "show") {
    const teamName = flags.team || positional[1];
    try {
      const config = teamName ? loadTeamConfig(teamName) : resolveTeam();
      return config;
    } catch (err) {
      return { error: err.message };
    }
  }

  return { error: `Unknown team action: ${action}` };
}

function handleState(flags, positional) {
  const action = positional[0] || "load";
  const workspaceRoot = process.cwd();

  if (action === "load") {
    return loadState(workspaceRoot);
  }

  if (action === "start-discussion") {
    const topic = flags.topic || positional.slice(1).join(" ");
    if (!topic) return { error: "Missing --topic or positional topic text" };

    const agents = flags.agents
      ? String(flags.agents).split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    const state = loadState(workspaceRoot);
    const updated = addDiscussion(state, topic, agents);
    saveState(workspaceRoot, updated);
    const disc = updated.discussions[updated.discussions.length - 1];
    return { discussion: disc };
  }

  if (action === "add-turn") {
    const discussionId = flags.discussion || positional[1];
    if (!discussionId) return { error: "Missing --discussion <id>" };

    const turn = {
      agent: flags.agent || null,
      engine: flags.engine || null,
      model: flags.model || null,
      position: positional.slice(discussionId === positional[1] ? 2 : 1).join(" "),
      timestamp: new Date().toISOString(),
    };

    try {
      const state = loadState(workspaceRoot);
      const updated = addTurn(state, discussionId, turn);
      saveState(workspaceRoot, updated);
      return { ok: true, turn };
    } catch (err) {
      return { error: err.message };
    }
  }

  if (action === "set-consensus") {
    const discussionId = flags.discussion || positional[1];
    if (!discussionId) return { error: "Missing --discussion <id>" };

    const consensusText = positional.slice(discussionId === positional[1] ? 2 : 1).join(" ");
    const state = loadState(workspaceRoot);
    const disc = getDiscussion(state, discussionId);
    if (!disc) return { error: `Discussion "${discussionId}" not found` };

    const updated = {
      ...state,
      discussions: state.discussions.map((d) =>
        d.id === discussionId ? { ...d, consensus: consensusText } : d
      ),
    };
    saveState(workspaceRoot, updated);
    return { ok: true, discussionId };
  }

  if (action === "show") {
    const discussionId = flags.discussion || positional[1];
    if (!discussionId) return { error: "Missing --discussion <id>" };
    const state = loadState(workspaceRoot);
    const disc = getDiscussion(state, discussionId);
    return disc || { error: `Discussion "${discussionId}" not found` };
  }

  return { error: `Unknown state action: ${action}` };
}

function handleDelegate(flags, positional) {
  const { agent, engine, model } = flags;
  const task = positional.join(" ");

  if (!engine || !model) {
    return { error: "Missing required flags: --engine and --model" };
  }

  const result = invokeEngine(engine, model, task, {
    timeout: normalizeTimeout(flags.timeout),
    write: true,
  });

  if (result) {
    result.agent = agent || null;
  }

  return result || { status: "native", engine: "claude", agent };
}

/**
 * Render a prompt template from the plugin's prompts/ directory.
 * Variables come from --var KEY=VALUE flags (repeatable) or from
 * a JSON blob passed positionally.
 */
function handlePrompt(flags, positional) {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) {
    return { error: "CLAUDE_PLUGIN_ROOT not set — cannot resolve prompt templates" };
  }

  const name = flags.name || positional[0];
  if (!name) return { error: "Missing --name <template>" };

  // Accept vars either as JSON body (positional[1] if --name was a flag,
  // otherwise positional[1]) or as repeated --var KEY=VALUE via a single
  // --vars JSON flag for simplicity.
  let vars = {};
  if (flags.vars) {
    try {
      vars = JSON.parse(String(flags.vars));
    } catch (err) {
      return { error: `--vars must be valid JSON: ${err.message}` };
    }
  }

  let template;
  try {
    template = loadPromptTemplate(pluginRoot, name);
  } catch (err) {
    return { error: `Template "${name}" not found: ${err.message}` };
  }

  return { name, rendered: interpolateTemplate(template, vars) };
}

// CLI entry point — called from commands via:
// node "${CLAUDE_PLUGIN_ROOT}/scripts/consensflow-companion.mjs" <subcommand> [flags] [args]
const argv = process.argv.slice(2);
if (argv.length > 0 && !argv[0].includes("vitest")) {
  const parsed = parseArgs(argv);
  const result = handleCommand(parsed);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

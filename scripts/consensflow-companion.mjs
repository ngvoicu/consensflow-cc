import { checkEngine, invokeEngine, ENGINE_CONFIGS } from "./lib/engines.mjs";
import { loadTeamConfig, listTeams, resolveTeam } from "./lib/config.mjs";
import { loadState, saveState, addDiscussion, addTurn, getDiscussion } from "./lib/state.mjs";
import { interpolateTemplate, loadPromptTemplate } from "./lib/prompts.mjs";
import { parseArgs } from "./lib/args.mjs";

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
    default:
      return {
        error: subcommand
          ? `Unknown subcommand: ${subcommand}`
          : "No subcommand provided. Use: setup, invoke, check, team, state, delegate",
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
    timeout: flags.timeout ? parseInt(flags.timeout) : undefined,
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

  return { error: `Unknown state action: ${action}` };
}

function handleDelegate(flags, positional) {
  const { agent, engine, model } = flags;
  const task = positional.join(" ");

  if (!engine || !model) {
    return { error: "Missing required flags: --engine and --model" };
  }

  const result = invokeEngine(engine, model, task, {
    timeout: flags.timeout ? parseInt(flags.timeout) : undefined,
    write: true,
  });

  if (result) {
    result.agent = agent || null;
  }

  return result || { status: "native", engine: "claude", agent };
}

// CLI entry point — called from commands via:
// node "${CLAUDE_PLUGIN_ROOT}/scripts/consensflow-companion.mjs" <subcommand> [flags] [args]
const argv = process.argv.slice(2);
if (argv.length > 0 && !argv[0].includes("vitest")) {
  const parsed = parseArgs(argv);
  const result = handleCommand(parsed);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

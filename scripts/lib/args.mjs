// Flags that take a value (everything else is boolean)
const VALUE_FLAGS = new Set([
  "agent", "agents", "team", "model", "engine", "timeout", "prompt",
]);

/**
 * Parse companion script arguments.
 * @param {string[]} argv - Arguments (without node and script path)
 * @returns {{ subcommand: string|null, flags: object, positional: string[] }}
 */
export function parseArgs(argv) {
  if (!argv || argv.length === 0) {
    return { subcommand: null, flags: {}, positional: [] };
  }

  const subcommand = argv[0].startsWith("--") ? null : argv[0];
  const flags = {};
  const positional = [];
  const startIdx = subcommand ? 1 : 0;

  for (let i = startIdx; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith("--")) {
      const key = arg.slice(2);

      if (VALUE_FLAGS.has(key) && i + 1 < argv.length) {
        flags[key] = argv[i + 1];
        i++; // skip the value
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { subcommand, flags, positional };
}

import { binaryAvailable, runCommand } from "./process.mjs";

/**
 * Default invocation timeout in milliseconds (180 s).
 * Protects the critical path from unbounded engine runs
 * (e.g., `codex --full-auto` looping forever).
 */
export const DEFAULT_INVOKE_TIMEOUT_MS = 180_000;

/**
 * Engine configurations for all supported engines.
 * Models are free strings — passed through to the CLI as-is.
 *
 * `buildArgs(model, prompt, { write })` returns the full argv vector.
 * Engines that accept a write/auto flag place it *before* the prompt
 * positional so CLI parsers (notably `codex exec`) don't attach it
 * to the prompt string.
 */
export const ENGINE_CONFIGS = {
  codex: {
    binary: "codex",
    versionArgs: ["--version"],
    buildArgs: (model, prompt, opts = {}) => {
      const args = ["exec", "--model", model];
      if (opts.write) args.push("--full-auto");
      args.push(prompt);
      return args;
    },
    supportsWrite: true,
  },
  opencode: {
    binary: "opencode",
    versionArgs: ["--version"],
    buildArgs: (model, prompt, opts = {}) => {
      const args = ["run", "-m", model];
      if (opts.write) args.push("--dangerously-skip-permissions");
      args.push(prompt);
      return args;
    },
    supportsWrite: true,
  },
  gemini: {
    binary: "gemini",
    versionArgs: ["--version"],
    // Gemini headless is read-only — write flag is ignored.
    buildArgs: (model, prompt) => ["-p", prompt, "-m", model, "-o", "text"],
    supportsWrite: false,
  },
  claude: {
    binary: null, // Native — no subprocess needed
    versionArgs: null,
    buildArgs: null,
    supportsWrite: false,
  },
};

/**
 * Classify a spawn result to decide whether a retry is worthwhile.
 * Transient failures (spawn errors, timeouts, generic non-zero) retry;
 * clearly permanent errors (unknown model / command / auth) do not.
 * @param {{ exitCode: number|null, error: object|null, signal: string|null, stderr: string }} result
 * @returns {boolean}
 */
export function shouldRetry(result) {
  // Timeouts are not retried — the work is already slow.
  if (result.signal === "SIGTERM" || result.signal === "SIGKILL") return false;

  // Spawn-level errors (ENOENT, etc.) are terminal for this binary.
  if (result.error) return false;

  // Success — nothing to retry.
  if (result.exitCode === 0) return false;

  const stderr = (result.stderr || "").toLowerCase();
  const permanent = [
    "not found",
    "unknown model",
    "invalid model",
    "unrecognized",
    "unauthorized",
    "authentication",
    "permission denied",
    "invalid api key",
    "no such",
  ];
  if (permanent.some((needle) => stderr.includes(needle))) return false;

  return true;
}

/**
 * Check if an engine is available on the system.
 * @param {string} engineName - One of: codex, opencode, gemini, claude
 * @returns {{ available: boolean, version: string|null, engine: string }}
 */
export function checkEngine(engineName) {
  const config = ENGINE_CONFIGS[engineName];
  if (!config) {
    return { available: false, version: null, engine: engineName };
  }

  // Claude is always available (it's the host)
  if (config.binary === null) {
    return { available: true, version: "native", engine: engineName };
  }

  const result = binaryAvailable(config.binary, config.versionArgs);
  return { ...result, engine: engineName };
}

/**
 * Invoke an engine with a prompt. Retries once on failure.
 * Returns null for claude engine (handled natively by skill).
 * @param {string} engineName
 * @param {string} model
 * @param {string} prompt
 * @param {{ timeout?: number, write?: boolean }} [options]
 * @returns {{ agent: string|null, engine: string, model: string, status: string, stdout: string, stderr: string, exitCode: number|null, durationMs: number }|null}
 */
export function invokeEngine(engineName, model, prompt, options = {}) {
  const config = ENGINE_CONFIGS[engineName];
  if (!config) {
    return {
      agent: null, engine: engineName, model, status: "failed",
      stdout: "", stderr: `Unknown engine: ${engineName}`, exitCode: 1, durationMs: 0,
    };
  }

  // Claude is native — not invoked via subprocess
  if (config.binary === null) {
    return null;
  }

  const write = Boolean(options.write) && config.supportsWrite;
  const args = config.buildArgs(model, prompt, { write });

  // Always apply a ceiling so a single engine can't stall the discussion.
  const timeout = Number.isFinite(options.timeout) && options.timeout > 0
    ? options.timeout
    : DEFAULT_INVOKE_TIMEOUT_MS;

  const start = Date.now();

  // First attempt
  let result = runCommand(config.binary, args, { timeout });

  // Retry once on transient failure only.
  if (shouldRetry(result)) {
    result = runCommand(config.binary, args, { timeout });
  }

  const durationMs = Date.now() - start;

  // Determine status
  let status = "completed";
  if (result.signal === "SIGTERM" || result.signal === "SIGKILL") {
    status = "timeout";
  } else if (result.exitCode !== 0 || result.error) {
    status = "failed";
  }

  return {
    agent: null, // Set by caller
    engine: engineName,
    model,
    status,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs,
  };
}

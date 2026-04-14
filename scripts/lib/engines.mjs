import { binaryAvailable, runCommand } from "./process.mjs";

/**
 * Engine configurations for all supported engines.
 * Models are free strings — passed through to the CLI as-is.
 */
export const ENGINE_CONFIGS = {
  codex: {
    binary: "codex",
    versionArgs: ["--version"],
    buildArgs: (model, prompt) => ["exec", "--model", model, prompt],
    writeArgs: ["--full-auto"],
  },
  opencode: {
    binary: "opencode",
    versionArgs: ["--version"],
    buildArgs: (model, prompt) => ["run", "-m", model, prompt],
    writeArgs: ["--dangerously-skip-permissions"],
  },
  gemini: {
    binary: "gemini",
    versionArgs: ["--version"],
    buildArgs: (model, prompt) => ["-p", prompt, "-m", model, "-o", "text"],
    writeArgs: null, // Gemini headless is read-only
  },
  claude: {
    binary: null, // Native — no subprocess needed
    versionArgs: null,
    buildArgs: null,
    writeArgs: null,
  },
};

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

  let args = config.buildArgs(model, prompt);

  // Add write flags if requested and supported
  if (options.write && config.writeArgs) {
    args = [...args, ...config.writeArgs];
  }

  const start = Date.now();

  // First attempt
  let result = runCommand(config.binary, args, { timeout: options.timeout });

  // Retry once on failure (non-zero exit or spawn error)
  if (result.exitCode !== 0 || result.error) {
    result = runCommand(config.binary, args, { timeout: options.timeout });
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

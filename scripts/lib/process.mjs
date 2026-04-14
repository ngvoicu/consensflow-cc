import { spawnSync } from "node:child_process";

/**
 * Check if a binary is available on the system.
 * @param {string} binary - The binary name to check
 * @param {string[]} versionArgs - Args to get version (e.g., ["--version"])
 * @returns {{ available: boolean, version: string|null }}
 */
export function binaryAvailable(binary, versionArgs) {
  const result = spawnSync(binary, versionArgs, {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 5000,
  });

  if (result.error || result.status !== 0) {
    return { available: false, version: null };
  }

  const version = result.stdout.trim() || null;
  return { available: true, version };
}

/**
 * Run a command synchronously and return structured result.
 * Uses array form of spawnSync to avoid shell injection.
 * @param {string} binary - The binary to execute
 * @param {string[]} args - Arguments array
 * @param {{ timeout?: number, cwd?: string }} [options]
 * @returns {{ stdout: string, stderr: string, exitCode: number|null, error: object|null, signal: string|null }}
 */
export function runCommand(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    stdio: "pipe",
    timeout: options.timeout,
    cwd: options.cwd,
  });

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status,
    error: result.error || null,
    signal: result.signal || null,
  };
}

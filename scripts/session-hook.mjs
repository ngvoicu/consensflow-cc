import fs from "node:fs";
import crypto from "node:crypto";

/**
 * Handle SessionStart hook event.
 * Injects CONSENSFLOW_SESSION_ID into the Claude Code environment.
 * @param {object} input - Hook input from stdin
 */
export function handleSessionStart(input) {
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (!envFile) {
    return; // No env file available — skip silently
  }

  const sessionId = `cf-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;

  fs.appendFileSync(
    envFile,
    `export CONSENSFLOW_SESSION_ID='${sessionId}'\n`,
    "utf8"
  );
}

/**
 * Handle SessionEnd hook event.
 * No-op for v1 — state cleanup handled by CLAUDE_PLUGIN_DATA lifecycle.
 * @param {object} input - Hook input from stdin
 */
export function handleSessionEnd(input) {
  // No cleanup needed for v1
}

// CLI entry point — called from hooks.json via:
// node "${CLAUDE_PLUGIN_ROOT}/scripts/session-hook.mjs" SessionStart|SessionEnd
const event = process.argv[2];
if (event === "SessionStart" || event === "SessionEnd") {
  let input = {};
  try {
    // Read hook input from stdin (non-blocking for empty stdin)
    const chunks = [];
    if (!process.stdin.isTTY) {
      const data = await new Promise((resolve) => {
        let buf = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => (buf += chunk));
        process.stdin.on("end", () => resolve(buf));
        setTimeout(() => resolve(buf), 500);
      });
      if (data) input = JSON.parse(data);
    }
  } catch {
    // Ignore stdin parse errors
  }

  if (event === "SessionStart") {
    handleSessionStart(input);
  } else {
    handleSessionEnd(input);
  }
}

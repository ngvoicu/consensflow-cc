// ChatGPT OAuth credentials for the gpt-image-2 backend, read from the Codex CLI's own auth
// store (the CC analog of pi's ctx.modelRegistry openai-codex token). Read-only: token refresh
// stays the codex CLI's job — an expired token surfaces as a 401 with a fix-it hint upstream.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decodeChatGptAccountId } from "./image.js";

export function codexAuthPath() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "auth.json");
}

// Returns { token, accountId }. Throws with a `codex login` hint when anything is missing.
export async function loadCodexAuth() {
  const authPath = codexAuthPath();
  let raw;
  try {
    raw = await fs.readFile(authPath, "utf8");
  } catch {
    throw new Error(`No Codex CLI login found (${authPath}). Run \`codex login\` (ChatGPT Plus/Pro) to use image participants.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse ${authPath} — run \`codex login\` again.`);
  }
  const tokens = parsed?.tokens;
  const token = typeof tokens?.access_token === "string" && tokens.access_token ? tokens.access_token : undefined;
  if (!token) {
    throw new Error(`${authPath} has no ChatGPT access token — run \`codex login\` (an API key alone cannot drive the gpt-image-2 backend).`);
  }
  let accountId = typeof tokens.account_id === "string" && tokens.account_id ? tokens.account_id : undefined;
  if (!accountId) {
    // Older auth files may lack the explicit field; the JWT claim carries it.
    try {
      accountId = decodeChatGptAccountId(token);
    } catch (error) {
      if (typeof tokens.id_token !== "string" || !tokens.id_token) throw error;
      accountId = decodeChatGptAccountId(tokens.id_token);
    }
  }
  return { token, accountId };
}

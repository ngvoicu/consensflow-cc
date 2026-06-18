#!/usr/bin/env node
// UserPromptSubmit hook: keep the session stash fresh, and when the typed prompt addresses
// exactly one configured participant (`@zeus …`, `ask @zeus …`, `hi @zeus`), stash the prompt
// body to a file and inject routing instructions for the lead. The CC analog of the pi
// extension's input interception — except the lead still sees the prompt, so unknown or
// ambiguous mentions are simply left alone. Must never block the prompt — always exits 0.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cfRoot, ensureCfDirs, loadParticipants, saveSession } from "../lib/state.js";
import { parseParticipantPrompt, slugify, tokenize } from "../lib/utils.js";
import { readStdinText } from "./hook-io.mjs";

const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cf.mjs");

function emitContext(text) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text } }));
}

try {
  // Inside a participant subprocess: never touch the lead session's stash, never route.
  if (process.env.CONSENSFLOW_CHILD) process.exit(0);
  const input = JSON.parse((await readStdinText()) || "{}");
  const cwd = input.cwd || process.cwd();
  await ensureCfDirs(cwd);
  await saveSession(cwd, { sessionId: input.session_id, transcriptPath: input.transcript_path });

  const prompt = String(input.prompt ?? "");
  if (!prompt.trim() || prompt.trimStart().startsWith("/")) process.exit(0);
  const tokens = tokenize(prompt);
  if (!tokens.some((token) => token.startsWith("@"))) process.exit(0);

  const participants = await loadParticipants(cwd).catch(() => []);
  const known = new Set(participants.flatMap((p) => [p.id, slugify(p.name)]).filter(Boolean));
  const parsed = parseParticipantPrompt(tokens, known);
  if (!parsed) process.exit(0);
  if (parsed.error) {
    emitContext(`ConsensFlow: ${parsed.error} Tell the user, and ask which participant to consult first — do not fan out to several.`);
    process.exit(0);
  }
  const id = slugify(parsed.participant);
  if (!known.has(id)) process.exit(0); // stray @token (e.g. @types/node): the lead handles the prompt normally

  const promptFile = path.join(cfRoot(cwd), "pending-prompt.md");
  await fs.writeFile(promptFile, parsed.prompt, "utf8");
  emitContext(
    [
      `ConsensFlow routing: this prompt addresses the participant @${id}. Consult it now via the Bash tool:`,
      "",
      `  node "${CLI_PATH}" run @${id} --prompt-file "${promptFile}" --stream`,
      "",
      "Participants can take minutes: always run this in the foreground and keep --stream on, with a generous Bash timeout (600000 ms or more), so the user sees the live thinking/tool/answer trail as it arrives. Never drop --stream, detach the run, or switch to --json to hide it. Then relay the participant's answer to the user faithfully — do not summarize the trail away.",
      "Do not apply, commit, or keep the participant's advice or file changes without the user's approval, unless the user already authorized it.",
    ].join("\n"),
  );
} catch {
  // A broken hook must never block the user's prompt.
}
process.exit(0);

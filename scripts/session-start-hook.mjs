#!/usr/bin/env node
// SessionStart hook: stash the live session's transcript path so cf.mjs can build handoffs
// (Bash subprocesses get no session env from the host), and surface a short ConsensFlow
// availability note as context. Must never block session start — always exits 0.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureCfDirs, loadParticipants, saveSession } from "../lib/state.js";
import { readStdinText } from "./hook-io.mjs";

const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cf.mjs");

try {
  // Inside a participant subprocess (claude-code child): never touch the lead session's stash.
  if (process.env.CONSENSFLOW_CHILD) process.exit(0);
  const input = JSON.parse((await readStdinText()) || "{}");
  const cwd = input.cwd || process.cwd();
  await ensureCfDirs(cwd);
  await saveSession(cwd, { sessionId: input.session_id, transcriptPath: input.transcript_path, source: input.source });

  const participants = await loadParticipants(cwd).catch(() => []);
  const roster = participants.length
    ? participants.map((p) => `@${p.id} (${p.kind}${p.model ? ` ${p.model}` : ""})`).join(", ")
    : "none configured yet — `participants add <preset>` (see `participants presets`)";
  console.log(
    [
      "ConsensFlow is available: consult one named AI participant (an external coding-agent CLI, run one-shot with a session handoff) for advice, second opinions, implementation help, or write-capable task execution.",
      `CLI: node "${CLI_PATH}" — subcommands: status | doctor | participants … | run @name <prompt>`,
      `Participants: ${roster}`,
      "Consulting is free and encouraged (one at a time). Acting is gated: never apply a participant's advice or file changes without the user's approval, unless they pre-authorized it.",
    ].join("\n"),
  );
} catch {
  // A broken hook must never break the session.
}
process.exit(0);

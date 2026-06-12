import { createPacket } from "./packets.js";
import { getParticipant } from "./state.js";
import { runParticipant } from "./runners.js";

const ADVISORY_ROLES = new Set(["reviewer", "council", "knowledge"]);

// Resolve the tools policy actually used at runtime. Fail safe: a participant is write-capable only
// when it has an explicit NON-advisory role (e.g. implementer). Purely-advisory roles
// (reviewer/council/knowledge) AND an empty/misconfigured roles set both coerce to read-only — so a
// participant can never end up unexpectedly write-capable through empty or bad roles input.
export function effectiveToolsPolicy(participant) {
  const roles = Array.isArray(participant.roles) ? participant.roles : [];
  const grantsWrite = roles.some((role) => !ADVISORY_ROLES.has(role));
  if (!grantsWrite) return "readonly";
  return participant.toolsPolicy ?? "readonly";
}

export function participantForKind(participant, _kind) {
  const toolsPolicy = effectiveToolsPolicy(participant);
  if (toolsPolicy === participant.toolsPolicy) return participant;
  return { ...participant, toolsPolicy };
}

export async function runNamedParticipant(input) {
  const { cwd, participantRef, kind = "ask", task, signal, extraContext, handoff, timeoutMs } = input;
  const configuredParticipant = typeof participantRef === "object" ? participantRef : await getParticipant(cwd, participantRef);
  if (!configuredParticipant) throw new Error(`Unknown participant: ${participantRef}`);
  const participant = participantForKind(configuredParticipant, kind);
  const packet = await createPacket({ cwd, participant, kind, task, extraContext, handoff });
  return await runParticipant({ cwd, participant, packet, kind, signal, timeoutMs });
}

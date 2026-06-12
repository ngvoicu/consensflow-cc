import { createPacket } from "./packets.js";
import { getParticipant } from "./state.js";
import { runParticipant } from "./runners.js";

// Resolve the tools policy actually used at runtime. Fail safe: a participant is write-capable
// only when it carries an explicit write policy (workspace-write/full-auto); a missing policy
// reads as readonly, so a participant can never end up unexpectedly write-capable.
export function effectiveToolsPolicy(participant) {
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

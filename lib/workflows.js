import { createPacket } from "./packets.js";
import { getParticipant, TOOL_POLICIES } from "./state.js";
import { runParticipant } from "./runners.js";

// Resolve the tools policy actually used at runtime. Fail safe: a participant is write-capable
// only when it carries an explicit write policy (workspace-write/full-auto); a missing policy
// reads as readonly, so a participant can never end up unexpectedly write-capable.
export function effectiveToolsPolicy(participant) {
  return participant.toolsPolicy ?? "readonly";
}

// The stored policy is the default; an explicit per-call override (e.g. cc's --rw, pi's toolsPolicy
// option) wins, so one roster entry can run read-only or write-capable without a second participant.
// Write stays explicit (call-time instead of config-time); an invalid override throws rather than
// silently granting/keeping the wrong capability. Never mutates the stored participant.
export function participantForKind(participant, _kind, overridePolicy) {
  let toolsPolicy = effectiveToolsPolicy(participant);
  if (overridePolicy !== undefined && overridePolicy !== null && overridePolicy !== "") {
    if (!TOOL_POLICIES.includes(overridePolicy)) {
      throw new Error(`tools policy must be one of: ${TOOL_POLICIES.join(", ")}`);
    }
    toolsPolicy = overridePolicy;
  }
  if (toolsPolicy === participant.toolsPolicy) return participant;
  return { ...participant, toolsPolicy };
}

export async function runNamedParticipant(input) {
  const { cwd, participantRef, kind = "ask", task, signal, extraContext, handoff, timeoutMs, onEvent, toolsPolicy } = input;
  const configuredParticipant = typeof participantRef === "object" ? participantRef : await getParticipant(cwd, participantRef);
  if (!configuredParticipant) throw new Error(`Unknown participant: ${participantRef}`);
  const participant = participantForKind(configuredParticipant, kind, toolsPolicy);
  const packet = await createPacket({ cwd, participant, kind, task, extraContext, handoff });
  return await runParticipant({ cwd, participant, packet, kind, signal, timeoutMs, onEvent });
}

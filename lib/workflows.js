import { createPacket } from "./packets.js";
import { getParticipant } from "./state.js";
import { runParticipant } from "./runners.js";

export async function runNamedParticipant(input) {
  const { cwd, participantRef, kind = "ask", task, signal, extraContext, handoff, onEvent } = input;
  const participant = typeof participantRef === "object" ? participantRef : await getParticipant(cwd, participantRef);
  if (!participant) throw new Error(`Unknown participant: ${participantRef}`);
  const packet = await createPacket({ cwd, participant, kind, task, extraContext, handoff });
  return await runParticipant({ cwd, participant, packet, kind, signal, onEvent });
}

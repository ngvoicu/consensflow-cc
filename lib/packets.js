import { nowIso } from "./utils.js";

export async function createPacket(input) {
  const {
    cwd,
    participant,
    task,
    extraContext = "",
    handoff = "",
  } = input;

  const writeCapable = participant.toolsPolicy && participant.toolsPolicy !== "readonly";

  const sections = [];
  sections.push("# ConsensFlow Packet");
  sections.push(`Created: ${nowIso()}`);
  sections.push(`Workspace: ${cwd}`);
  sections.push("");

  sections.push("## Who you are");
  sections.push(`You are ${participant.name}, joining a coding session as a named participant.`);
  const specs = [`kind=${participant.kind}`];
  if (participant.model) specs.push(`model=${participant.model}`);
  if (participant.effort) specs.push(`effort=${participant.effort}`);
  if (participant.thinking) specs.push(`thinking=${participant.thinking}`);
  specs.push(`roles=${(participant.roles ?? []).join(", ") || "unspecified"}`);
  sections.push(specs.join(" · "));
  sections.push("");

  sections.push("## Mode");
  if (writeCapable) {
    sections.push("Read-write: you can read and modify this workspace — edit files and run commands as needed to carry out the request, like a normal coding session.");
  } else {
    sections.push("Read-only: you can inspect the workspace to inform your answer, but do not modify files.");
  }
  sections.push("");

  if (handoff && String(handoff).trim()) {
    sections.push("## Handoff — current session");
    sections.push("The conversation so far between the user and the lead coding agent, most recent last. You were not part of it; use it as context for the request below.");
    sections.push("");
    sections.push(String(handoff).trim());
    sections.push("");
  }

  if (extraContext && String(extraContext).trim()) {
    sections.push("## Note from the lead");
    sections.push(String(extraContext).trim());
    sections.push("");
  }

  sections.push("## Message from the user");
  sections.push(taskForKind("ask", task));
  sections.push("");
  sections.push("Respond directly and conversationally, the way you would in a normal coding session. There is no required format.");
  sections.push("");
  return sections.join("\n");
}

export function taskForKind(_kind, baseTask) {
  return String(baseTask ?? "").trim() || "Respond to the user's message.";
}

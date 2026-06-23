// Image generation for `image`-kind participants.
//
// Uses the OpenAI Codex ChatGPT "Responses" backend's native image_generation tool (which the
// backend maps to gpt-image-2), riding the Codex CLI's existing ChatGPT login. No extra API key —
// the caller passes the token it got from codex-auth.js. Same protocol as consensflow-pi's
// image.js (which rides Pi's openai-codex login instead).

import fs from "node:fs/promises";
import path from "node:path";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const JWT_AUTH_CLAIM = "https://api.openai.com/auth";

export const IMAGE_BACKEND = "gpt-image-2";
export const IMAGE_TRIGGER_DEFAULT = "gpt-5.5";

// Reference-image file extensions the Codex Responses backend accepts as input_image parts.
const IMAGE_MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// Read a reference image file and return a `data:<mime>;base64,…` URL for an input_image content part.
export async function imageFileToDataUrl(filePath) {
  const ext = path.extname(String(filePath ?? "")).toLowerCase();
  const mime = IMAGE_MIME_BY_EXT[ext];
  if (!mime) {
    throw new Error(`Unsupported reference image "${filePath}" (${ext || "no extension"}) — use .png, .jpg, .jpeg, .webp, or .gif.`);
  }
  const bytes = await fs.readFile(filePath);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

// Extract the chatgpt_account_id claim from a ChatGPT OAuth JWT (a required header).
export function decodeChatGptAccountId(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new Error("Codex token is not a JWT — run `codex login` (ChatGPT Plus/Pro).");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch (error) {
    throw new Error(`Failed to decode Codex token: ${error instanceof Error ? error.message : String(error)}`);
  }
  const claims = payload?.[JWT_AUTH_CLAIM];
  const accountId = claims && typeof claims === "object" ? claims.chatgpt_account_id : undefined;
  if (typeof accountId !== "string" || !accountId) {
    throw new Error("Codex token has no chatgpt_account_id — run `codex login` again.");
  }
  return accountId;
}

// Build the Codex Responses request body that triggers exactly one image_generation call. Optional
// `images` are data-URL strings appended as input_image parts so gpt-image-2 uses them as references.
export function buildImageRequestBody(prompt, triggerModel = IMAGE_TRIGGER_DEFAULT, images = []) {
  const refs = (Array.isArray(images) ? images : []).filter((url) => typeof url === "string" && url);
  const content = [{ type: "input_text", text: String(prompt ?? "") }];
  for (const imageUrl of refs) content.push({ type: "input_image", detail: "auto", image_url: imageUrl });
  return {
    model: triggerModel,
    store: false,
    stream: true,
    instructions: refs.length
      ? "You are generating a bitmap image asset, using the provided reference image(s) as visual guidance. Call the image_generation tool exactly once. Do not answer with only text unless image generation is unavailable."
      : "You are generating a bitmap image asset. Call the image_generation tool exactly once. Do not answer with only text unless image generation is unavailable.",
    input: [{ role: "user", content }],
    tools: [{ type: "image_generation", output_format: "png" }],
    tool_choice: "auto",
    parallel_tool_calls: false,
    text: { verbosity: "low" },
  };
}

// Given parsed SSE event objects, pull out the generated image (base64) + metadata.
export function extractImageFromEvents(events) {
  const out = { base64: undefined, revisedPrompt: undefined, responseId: undefined, status: undefined, text: "" };
  const texts = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== "object") continue;
    if (event.type === "error") throw new Error(`Codex error: ${event.message || event.code || "unknown"}`);
    if (event.type === "response.failed") throw new Error(event.response?.error?.message || "Codex response failed.");
    if ((event.type === "response.created" || event.type === "response.completed") && event.response?.id) {
      out.responseId = event.response.id;
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") texts.push(event.delta);
    if (event.type === "response.output_item.done" && event.item?.type === "image_generation_call") {
      const item = event.item;
      if (typeof item.result === "string" && item.result) {
        out.base64 = item.result;
        out.status = String(item.status || "completed");
        if (typeof item.revised_prompt === "string") out.revisedPrompt = item.revised_prompt;
      }
    }
  }
  out.text = texts.join("");
  return out;
}

// Pull the "data:" JSON payload out of one SSE chunk (between blank-line separators).
function sseChunkToJson(chunk) {
  const data = chunk
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

// Call the Codex Responses backend and return { base64, revisedPrompt, responseId, status }.
export async function generateImage({ token, accountId, prompt, triggerModel, images, signal }) {
  const body = JSON.stringify(buildImageRequestBody(prompt, triggerModel || IMAGE_TRIGGER_DEFAULT, images));
  const response = await fetch(CODEX_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "chatgpt-account-id": accountId,
      // We present the codex CLI's own token, so use its native originator.
      originator: "codex_cli_rs",
      "OpenAI-Beta": "responses=experimental",
      accept: "text/event-stream",
      "content-type": "application/json",
    },
    body,
    signal,
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const hint = response.status === 401 ? " The Codex login token may have expired — run `codex login` (or use codex once) and retry." : "";
    throw new Error(`Codex image generation failed (${response.status}): ${errorText.slice(0, 500)}${hint}`);
  }
  if (!response.body) throw new Error("Codex image response had no stream body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const json = sseChunkToJson(buffer.slice(0, sep));
        if (json) events.push(json);
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf("\n\n");
      }
    }
    const tail = sseChunkToJson(buffer);
    if (tail) events.push(tail);
  } finally {
    try {
      await reader.cancel();
    } catch {
      // stream may already be closed
    }
  }

  const result = extractImageFromEvents(events);
  if (!result.base64) {
    throw new Error(result.text ? `No image returned. Codex said: ${result.text.slice(0, 300)}` : "No image returned by Codex.");
  }
  return result;
}

// Save a base64 PNG under <dir>/<filename>; returns the absolute path.
export async function saveImagePng(base64, dir, filename = "image.png") {
  const filePath = path.join(dir, filename);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, Buffer.from(String(base64 ?? ""), "base64"));
  return filePath;
}

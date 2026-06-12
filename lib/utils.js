import crypto from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(value) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || "participant";
}

export function createId(prefix = "run", date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const rand = crypto.randomBytes(4).toString("hex");
  return `${prefix}-${stamp}-${rand}`;
}

export function stripMention(value) {
  return String(value ?? "").replace(/^@+/, "");
}

export function tokenize(input) {
  const text = String(input ?? "");
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const ch of text) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (escaping) current += "\\";
  if (current.length > 0) tokens.push(current);
  return tokens;
}

export function parseOptions(tokens) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--") || token === "--") {
      positional.push(token);
      continue;
    }
    const raw = token.slice(2);
    const eq = raw.indexOf("=");
    if (eq >= 0) {
      flags[raw.slice(0, eq)] = raw.slice(eq + 1);
      continue;
    }
    const next = tokens[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[raw] = next;
      i += 1;
    } else {
      flags[raw] = true;
    }
  }
  return { positional, flags };
}

// Canonicalize a path that may not fully exist: realpath the deepest existing ancestor, then
// re-append the non-existent tail. Falls back to the lexical path when nothing exists.
function canonicalize(target) {
  let base = target;
  const tail = [];
  for (;;) {
    try {
      const real = realpathSync(base);
      return tail.length === 0 ? real : path.join(real, ...tail);
    } catch {
      const parent = path.dirname(base);
      if (parent === base) return target;
      tail.unshift(path.basename(base));
      base = parent;
    }
  }
}

// Lexical containment alone is not enough: a symlinked subdir (ws/link -> /outside) passes a
// path.relative check but escapes the workspace on disk. Compare canonical (symlink-resolved)
// paths so the guard holds for what the subprocess will actually see as its cwd.
export function resolveInside(cwd, requested) {
  const root = canonicalize(path.resolve(cwd));
  const resolved = canonicalize(path.resolve(root, requested || "."));
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${requested}`);
  }
  return resolved;
}

export function truncateText(text, maxBytes = 128 * 1024) {
  const value = String(text ?? "");
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) return { text: value, truncated: false, bytes };
  let sliced = value.slice(0, maxBytes);
  while (Buffer.byteLength(sliced, "utf8") > maxBytes) sliced = sliced.slice(0, -1);
  return {
    text: `${sliced}\n\n[truncated: ${bytes - Buffer.byteLength(sliced, "utf8")} bytes omitted]`,
    truncated: true,
    bytes,
  };
}

const ONE_PARTICIPANT_AT_A_TIME =
  "ConsensFlow sends to one participant at a time. Use `@zeus ...`, wait for the answer, then ask another participant if needed.";

// Decide whether a typed prompt addresses exactly one named participant.
// - A leading mention (`@zeus ...`, or `ask @zeus ...`) is an explicit address: it routes
//   regardless of whether the name is configured (an unknown name surfaces a helpful error
//   downstream), and any other @names later in the prompt are kept verbatim so you can paste a
//   prior participant's reply into the next prompt.
// - A single mention elsewhere (`hi @zeus`) routes the same way — but ONLY when it resolves to a
//   known participant, so a stray `@types/node` / `@Component` in a prompt to the lead is left
//   alone. `known` is a Set of slugified participant ids/names (matching getParticipant's
//   resolution); omit it to disable non-leading routing.
// Returns { participant, prompt } | { error } | null  (null = not a participant prompt).
export function parseParticipantPrompt(tokens, known) {
  if (!Array.isArray(tokens) || tokens.length === 0) return null;

  let body = tokens;
  const first = tokens[0]?.toLowerCase();
  if ((first === "ask" || first === "to") && tokens[1]?.startsWith("@")) body = tokens.slice(1);
  if (body.length === 0) return null;

  if (body[0].startsWith("@")) {
    if (body[1]?.startsWith("@")) return { error: ONE_PARTICIPANT_AT_A_TIME };
    const participant = stripMention(body[0]);
    const prompt = body.slice(1).join(" ").trim();
    if (!prompt) return { error: `Prompt is required after @${participant}.` };
    return { participant, prompt };
  }

  const mentions = body.filter((token) => token.startsWith("@"));
  if (mentions.length === 0) return null;
  const distinct = new Set(mentions.map((token) => slugify(stripMention(token))));
  if (distinct.size !== 1) return null; // 2+ different names, none leading -> ambiguous, lead handles
  const participant = stripMention(mentions[0]);
  const knownSet = known instanceof Set ? known : null;
  if (!knownSet || !knownSet.has(slugify(participant))) return null; // unknown @token -> not a target
  const prompt = body.filter((token) => !token.startsWith("@")).join(" ").trim();
  if (!prompt) return null;
  return { participant, prompt };
}

import { slugify, stripMention } from "./utils.js";


// Same catalog as consensflow-pi, image preset included: here pygmalion rides the Codex CLI's
// ChatGPT login (lib/codex-auth.js) to the same gpt-image-2 backend pi reaches via its
// openai-codex login.
export const PARTICIPANT_PRESETS = [
  // --- Claude Fable 5 — Anthropic's most capable model (priced above Opus).
  // Muse names on claude-code; bard/storyteller names on the other engines.
  {
    preset: "calliope",
    id: "calliope",
    name: "Calliope",
    label: "Claude Code Fable 5 MAX",
    description: "Chief muse: Claude Fable 5 at max effort — the deepest Claude-powered collaborator in the catalog. Turns can run many minutes.",
    kind: "claude-code",
    model: "claude-fable-5",
    effort: "max",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "clio",
    id: "clio",
    name: "Clio",
    label: "Claude Code Fable 5 XHIGH",
    description: "Muse of history: Claude Fable 5 at xhigh effort, the recommended tier for coding, planning, and agentic work.",
    kind: "claude-code",
    model: "claude-fable-5",
    effort: "xhigh",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "euterpe",
    id: "euterpe",
    name: "Euterpe",
    label: "Claude Code Fable 5 HIGH",
    description: "Muse of music: Claude Fable 5 at high effort — strong reasoning without the xhigh wait.",
    kind: "claude-code",
    model: "claude-fable-5",
    effort: "high",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "thalia",
    id: "thalia",
    name: "Thalia",
    label: "Claude Code Fable 5 MEDIUM",
    description: "Muse of comedy: Claude Fable 5 at medium effort for quicker takes from the top model.",
    kind: "claude-code",
    model: "claude-fable-5",
    effort: "medium",
    toolsPolicy: "workspace-write",
  },

  // --- GPT 5.6 celestial trio (Codex) --------------------------------------
  // OpenAI's 2026 family: Sol (flagship), Terra (balanced), Luna (fast/affordable).
  // Codex's 5.6 effort ladder extends past xhigh with "max" and "ultra" (ultra =
  // max reasoning + automatic task delegation; Sol/Terra only). All combos verified live.
  {
    preset: "hyperion",
    id: "hyperion",
    name: "Hyperion",
    label: "Codex GPT 5.6 Sol ULTRA",
    description: "Titan of heavenly light: GPT 5.6 Sol — the flagship variant — at ultra effort (maximum reasoning with automatic task delegation), the deepest Codex participant in the catalog. Turns can run many minutes.",
    kind: "codex",
    model: "gpt-5.6-sol",
    effort: "ultra",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "phoebus",
    id: "phoebus",
    name: "Phoebus",
    label: "Codex GPT 5.6 Sol XHIGH",
    description: "The radiant sun: GPT 5.6 Sol at xhigh effort — flagship depth without the ultra wait.",
    kind: "codex",
    model: "gpt-5.6-sol",
    effort: "xhigh",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "gaia",
    id: "gaia",
    name: "Gaia",
    label: "Codex GPT 5.6 Terra XHIGH",
    description: "Primordial earth: GPT 5.6 Terra — the mid-size variant — at xhigh effort for strong everyday coding and planning.",
    kind: "codex",
    model: "gpt-5.6-terra",
    effort: "xhigh",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "diana",
    id: "diana",
    name: "Diana",
    label: "Codex GPT 5.6 Luna XHIGH",
    description: "Roman moon goddess: GPT 5.6 Luna — the compact, fast variant — at xhigh effort for quick, sharp takes.",
    kind: "codex",
    model: "gpt-5.6-luna",
    effort: "xhigh",
    toolsPolicy: "workspace-write",
  },

  // --- GPT 5.6 on the other engines that reach it --------------------------
  // Pi rides the same ChatGPT (Codex) login the codex trio uses — no OpenRouter
  // credits; OpenCode reaches the same three variants through OpenRouter, whose
  // catalog lists openai/gpt-5.6-{sol,terra,luna}. Greek names on pi, Norse on
  // opencode, matching the rest of the catalog.
  {
    preset: "aether",
    id: "aether",
    name: "Aether",
    label: "Pi GPT 5.6 Sol XHIGH",
    description: "Primordial upper air and light: GPT 5.6 Sol — the flagship variant — on Pi, riding your ChatGPT (Codex) login at xhigh thinking.",
    kind: "pi",
    model: "openai-codex/gpt-5.6-sol",
    thinking: "xhigh",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "rhea",
    id: "rhea",
    name: "Rhea",
    label: "Pi GPT 5.6 Terra XHIGH",
    description: "Titaness of the earth: GPT 5.6 Terra — the balanced variant — on Pi via your ChatGPT (Codex) login at xhigh thinking.",
    kind: "pi",
    model: "openai-codex/gpt-5.6-terra",
    thinking: "xhigh",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "phoebe",
    id: "phoebe",
    name: "Phoebe",
    label: "Pi GPT 5.6 Luna XHIGH",
    description: "Titaness of the moon: GPT 5.6 Luna — the compact, fast variant — on Pi via your ChatGPT (Codex) login at xhigh thinking.",
    kind: "pi",
    model: "openai-codex/gpt-5.6-luna",
    thinking: "xhigh",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "sunna",
    id: "sunna",
    name: "Sunna",
    label: "OpenCode GPT 5.6 Sol XHIGH",
    description: "Norse sun goddess: GPT 5.6 Sol — the flagship variant — through OpenCode on OpenRouter at xhigh effort.",
    kind: "opencode",
    model: "openrouter/openai/gpt-5.6-sol",
    effort: "xhigh",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "jord",
    id: "jord",
    name: "Jord",
    label: "OpenCode GPT 5.6 Terra XHIGH",
    description: "Norse earth goddess, mother of Thor: GPT 5.6 Terra — the balanced variant — through OpenCode on OpenRouter at xhigh effort.",
    kind: "opencode",
    model: "openrouter/openai/gpt-5.6-terra",
    effort: "xhigh",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "bil",
    id: "bil",
    name: "Bil",
    label: "OpenCode GPT 5.6 Luna XHIGH",
    description: "The child who follows Mani across the night sky: GPT 5.6 Luna — the compact, fast variant — through OpenCode on OpenRouter at xhigh effort.",
    kind: "opencode",
    model: "openrouter/openai/gpt-5.6-luna",
    effort: "xhigh",
    toolsPolicy: "workspace-write",
  },

  // --- House team: strong default participants per engine --------------------
  {
    preset: "zeus",
    id: "zeus",
    name: "Zeus",
    label: "Claude Code Opus 5 MAX",
    description: "Deepest Opus-tier Claude Code participant for high-stakes architecture, implementation plans, and final checks; half the price of Fable 5, which stays the catalog ceiling (@calliope).",
    kind: "claude-code",
    model: "claude-opus-5",
    effort: "max",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "apollo",
    id: "apollo",
    name: "Apollo",
    label: "Claude Code Opus 5 XHIGH",
    description: "Deep but slightly cheaper/faster Claude Code participant for spec critique, design alternatives, and implementation plans.",
    kind: "claude-code",
    model: "claude-opus-5",
    effort: "xhigh",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "artemis",
    id: "artemis",
    name: "Artemis",
    label: "Claude Code Opus 5 MEDIUM",
    description: "Apollo's twin: Opus 5 at medium effort for quicker, cheaper Claude Code takes.",
    kind: "claude-code",
    model: "claude-opus-5",
    effort: "medium",
    toolsPolicy: "workspace-write",
  },

  // --- Frontier models on the other engines that run them ------------------
  // Fable 5 on pi (anthropic provider) and OpenCode (OpenRouter). Both cap at xhigh.
  {
    preset: "orpheus",
    id: "orpheus",
    name: "Orpheus",
    label: "Pi Fable 5 XHIGH (Anthropic)",
    description: "The legendary bard: Pi-backed Claude Fable 5 with xhigh thinking; needs Anthropic auth in pi.",
    kind: "pi",
    model: "anthropic/claude-fable-5",
    thinking: "xhigh",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "linus",
    id: "linus",
    name: "Linus",
    label: "Pi Fable 5 HIGH (Anthropic)",
    description: "Orpheus's bard brother: Pi-backed Claude Fable 5 with high thinking; needs Anthropic auth in pi.",
    kind: "pi",
    model: "anthropic/claude-fable-5",
    thinking: "high",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "erato",
    id: "erato",
    name: "Erato",
    label: "Pi Fable 5 MEDIUM (Anthropic)",
    description: "Muse of lyric poetry: Pi-backed Claude Fable 5 with medium thinking; needs Anthropic auth in pi.",
    kind: "pi",
    model: "anthropic/claude-fable-5",
    thinking: "medium",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "saga",
    id: "saga",
    name: "Saga",
    label: "OpenCode Fable 5 XHIGH",
    description: "Norse goddess of storytelling: OpenCode-backed Claude Fable 5 at xhigh variant (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/anthropic/claude-fable-5",
    effort: "xhigh",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "gunnlod",
    id: "gunnlod",
    name: "Gunnlod",
    label: "OpenCode Fable 5 HIGH",
    description: "Guardian of the mead of poetry: OpenCode-backed Claude Fable 5 at high variant (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/anthropic/claude-fable-5",
    effort: "high",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "kvasir",
    id: "kvasir",
    name: "Kvasir",
    label: "OpenCode Fable 5 MEDIUM",
    description: "Source of the mead of poetry: OpenCode-backed Claude Fable 5 at medium variant (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/anthropic/claude-fable-5",
    effort: "medium",
    toolsPolicy: "workspace-write",
  },
  // Opus 5 on pi (anthropic provider). pi's model layer gained a "max" thinking level in
  // @earendil-works/pi-ai 0.82 (verified in its registry: claude-opus-5 maps xhigh AND max),
  // but the pi releases shipping today still bundle an older pi-ai that caps at xhigh — so
  // these stay at xhigh/medium, which is valid on both.
  {
    preset: "kronos",
    id: "kronos",
    name: "Kronos",
    label: "Pi Opus 5 XHIGH (Anthropic)",
    description: "Pi-backed Claude Opus 5 with xhigh thinking; needs Anthropic auth in pi.",
    kind: "pi",
    model: "anthropic/claude-opus-5",
    thinking: "xhigh",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "atlas",
    id: "atlas",
    name: "Atlas",
    label: "Pi Opus 5 MEDIUM (Anthropic)",
    description: "Pi-backed Claude Opus 5 with medium thinking; needs Anthropic auth in pi.",
    kind: "pi",
    model: "anthropic/claude-opus-5",
    thinking: "medium",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  // Opus 5 on OpenCode (via OpenRouter). Unlike the 4.8 generation there is no dotted id:
  // it is plainly anthropic/claude-opus-5. Kept at the xhigh/medium tiers the 4.8 pair used.
  {
    preset: "baldr",
    id: "baldr",
    name: "Baldr",
    label: "OpenCode Opus 5 XHIGH",
    description: "OpenCode-backed Claude Opus 5 at xhigh variant (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/anthropic/claude-opus-5",
    effort: "xhigh",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "vali",
    id: "vali",
    name: "Vali",
    label: "OpenCode Opus 5 MEDIUM",
    description: "OpenCode-backed Claude Opus 5 at medium variant (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/anthropic/claude-opus-5",
    effort: "medium",
    toolsPolicy: "workspace-write",
  },
  // GPT 5.5 on OpenCode (via OpenRouter).

  // --- Fast/cheap tier: quick gut-checks ----------------------------------
  {
    preset: "hermod",
    id: "hermod",
    name: "Hermod",
    label: "Claude Code Haiku 4.5 (fast)",
    description: "Fast, cheap Claude Code participant (Haiku) for quick gut-checks.",
    kind: "claude-code",
    model: "claude-haiku-4-5",
    effort: "low",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "nike",
    id: "nike",
    name: "Nike",
    label: "Pi Gemini 3.6 Flash (fast)",
    description: "Swift, cheap Pi-backed Gemini 3.6 Flash for quick second opinions.",
    kind: "pi",
    model: "openrouter/google/gemini-3.6-flash",
    thinking: "low",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "freya",
    id: "freya",
    name: "Freya",
    label: "OpenCode DeepSeek V4 Flash (fast)",
    description: "Cheap, fast OpenCode-backed DeepSeek V4 Flash (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/deepseek/deepseek-v4-flash",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "zephyros",
    id: "zephyros",
    name: "Zephyros",
    label: "Pi DeepSeek V4 Flash (fast)",
    description: "Swift west wind: Pi-backed DeepSeek V4 Flash (via OpenRouter).",
    kind: "pi",
    model: "openrouter/deepseek/deepseek-v4-flash",
    thinking: "low",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "sif",
    id: "sif",
    name: "Sif",
    label: "OpenCode Gemini 3.6 Flash (fast)",
    description: "Swift, cheap OpenCode-backed Gemini 3.6 Flash at low variant (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/google/gemini-3.6-flash",
    effort: "low",
    toolsPolicy: "workspace-write",
  },

  // --- pi model zoo (Greek names) — popular OpenRouter models via Pi -------
  {
    preset: "hades",
    id: "hades",
    name: "Hades",
    label: "Pi DeepSeek V4 Pro",
    description: "Pi-backed DeepSeek V4 Pro participant (via OpenRouter).",
    kind: "pi",
    model: "openrouter/deepseek/deepseek-v4-pro",
    thinking: "high",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "helios",
    id: "helios",
    name: "Helios",
    label: "Pi Gemini 3.1 Pro",
    description: "Pi-backed Google Gemini 3.1 Pro participant (via OpenRouter).",
    kind: "pi",
    model: "openrouter/google/gemini-3.1-pro-preview",
    thinking: "high",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "ares",
    id: "ares",
    name: "Ares",
    label: "Pi Grok 4.5",
    description: "Pi-backed xAI Grok 4.5 participant (via OpenRouter).",
    kind: "pi",
    model: "openrouter/x-ai/grok-4.5",
    thinking: "high",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "hephaestus",
    id: "hephaestus",
    name: "Hephaestus",
    label: "Pi Qwen3.7 Max",
    description: "Pi-backed Qwen3.7 Max participant (via OpenRouter).",
    kind: "pi",
    model: "openrouter/qwen/qwen3.7-max",
    thinking: "high",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "pan",
    id: "pan",
    name: "Pan",
    label: "Pi Llama 4 Maverick",
    description: "Pi-backed Meta Llama 4 Maverick participant (via OpenRouter).",
    kind: "pi",
    model: "openrouter/meta-llama/llama-4-maverick",
    thinking: "high",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "aeolus",
    id: "aeolus",
    name: "Aeolus",
    label: "Pi Mistral Large",
    description: "Pi-backed Mistral Large participant (via OpenRouter); wind god for 'mistral'.",
    kind: "pi",
    model: "openrouter/mistralai/mistral-large-2512",
    thinking: "high",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "metis",
    id: "metis",
    name: "Metis",
    label: "Pi MiniMax M3",
    description: "Pi-backed MiniMax M3 participant (via OpenRouter); goddess of cunning strategy for 'minimax'.",
    kind: "pi",
    model: "openrouter/minimax/minimax-m3",
    thinking: "high",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "prometheus",
    id: "prometheus",
    name: "Prometheus",
    label: "Pi GLM 5.2",
    description: "Pi-backed Zhipu GLM 5.2 participant (via OpenRouter); the Titan who brought knowledge to mortals.",
    kind: "pi",
    model: "openrouter/z-ai/glm-5.2",
    thinking: "high",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "endymion",
    id: "endymion",
    name: "Endymion",
    label: "Pi Kimi K3 XHIGH",
    description: "Beloved of the moon goddess: Pi-backed Kimi K3 — Moonshot's 1M-context flagship reasoner — at xhigh thinking, OpenRouter's effort ceiling (needs the kimi-k3 entry in ~/.pi/agent/models.json for sane token limits and xhigh support).",
    kind: "pi",
    model: "openrouter/moonshotai/kimi-k3",
    thinking: "xhigh",
    skillsPolicy: "default",
    toolsPolicy: "workspace-write",
  },

  // --- opencode model zoo (Norse names) — same models via OpenCode --------
  {
    preset: "odin",
    id: "odin",
    name: "Odin",
    label: "OpenCode DeepSeek V4 Pro",
    description: "OpenCode-backed DeepSeek V4 Pro participant (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/deepseek/deepseek-v4-pro",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "heimdall",
    id: "heimdall",
    name: "Heimdall",
    label: "OpenCode Gemini 3.1 Pro",
    description: "OpenCode-backed Google Gemini 3.1 Pro participant at high variant (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/google/gemini-3.1-pro-preview",
    effort: "high",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "thor",
    id: "thor",
    name: "Thor",
    label: "OpenCode Grok 4.5",
    description: "OpenCode-backed xAI Grok 4.5 participant (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/x-ai/grok-4.5",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "tyr",
    id: "tyr",
    name: "Tyr",
    label: "OpenCode Qwen3.7 Max",
    description: "OpenCode-backed Qwen3.7 Max participant (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/qwen/qwen3.7-max",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "vidar",
    id: "vidar",
    name: "Vidar",
    label: "OpenCode Llama 4 Maverick",
    description: "OpenCode-backed Meta Llama 4 Maverick participant (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/meta-llama/llama-4-maverick",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "njord",
    id: "njord",
    name: "Njord",
    label: "OpenCode Mistral Large",
    description: "OpenCode-backed Mistral Large participant (via OpenRouter); sea/wind god for 'mistral'.",
    kind: "opencode",
    model: "openrouter/mistralai/mistral-large-2512",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "mimir",
    id: "mimir",
    name: "Mimir",
    label: "OpenCode MiniMax M3",
    description: "OpenCode-backed MiniMax M3 participant (via OpenRouter); god of wisdom for 'minimax'.",
    kind: "opencode",
    model: "openrouter/minimax/minimax-m3",
    toolsPolicy: "workspace-write",
  },
  {
    preset: "mani",
    id: "mani",
    name: "Mani",
    label: "OpenCode Kimi K3",
    description: "Norse moon god: OpenCode-backed Kimi K3 — Moonshot's 1M-context flagship reasoner (via OpenRouter). Runs at K3's default max thinking; the catalog defines no effort variants for it.",
    kind: "opencode",
    model: "openrouter/moonshotai/kimi-k3",
    toolsPolicy: "workspace-write",
  },

  // --- Image generation (Codex backend → gpt-image-2) ---------------------
  {
    preset: "pygmalion",
    id: "pygmalion",
    name: "Pygmalion",
    label: "Image — gpt-image-2 (via Codex login)",
    description: "Generates images with gpt-image-2 through your existing Codex (ChatGPT) login. Accepts optional reference images (`--image <path>`, repeatable) to edit/condition on. The model field is only the trigger model; the image backend is always gpt-image-2.",
    kind: "image",
    model: "gpt-5.5",
    toolsPolicy: "workspace-write",
  },
];

export function getPreset(ref) {
  const id = slugify(stripMention(ref));
  return PARTICIPANT_PRESETS.find((preset) => preset.preset === id || preset.id === id || slugify(preset.name) === id) ?? null;
}

export function listPresetIds() {
  return PARTICIPANT_PRESETS.map((preset) => preset.preset);
}

export function participantFromPreset(ref, overrides = {}) {
  const preset = getPreset(ref);
  if (!preset) return null;
  const nameOverride = stringOverride(overrides.name);
  const idOverride = stringOverride(overrides.id);
  const name = nameOverride ?? preset.name;
  // Keep the preset's canonical id; only derive a new id when the caller renames (--name) or sets
  // an explicit id.
  const id = slugify(idOverride ?? nameOverride ?? preset.id);
  const participant = {
    ...preset,
    ...allowedOverrides(overrides),
    preset: preset.preset,
    id,
    name,
    kind: preset.kind,
    model: preset.model,
    effort: preset.effort,
    thinking: preset.thinking,
    toolsPolicy: preset.toolsPolicy,
    skillsPolicy: preset.skillsPolicy,
  };
  delete participant.label;
  return participant;
}

// --- Catalog drift -------------------------------------------------------
// A roster entry snapshots its preset's engine fields, so a ConsensFlow update that ships a new
// catalog (Opus 4.8 → Opus 5, say) does not reach participants that were already added. These
// helpers re-resolve that: the fields below are decided entirely by the preset — participantFromPreset
// lets only --name/--id/--cwd/--description through and there is no `participants edit` — so replacing
// them with the catalog's current values is lossless.
// `description` is deliberately NOT in this list, for two independent reasons: it is a documented
// user override (`add <preset> --description …`), and the two hosts intentionally word a few
// descriptions differently (pygmalion's login wording) while sharing ONE roster — syncing it would
// clobber the user's text and, worse, never converge: each host would forever see the other's
// wording as drift and re-flag the nudge. Stale description text is cosmetic (it never reaches the
// packet); a wrong model is not.
// Participants with no `preset`, or whose preset has since left the catalog, are left alone.
export const PRESET_OWNED_FIELDS = ["kind", "model", "effort", "thinking", "toolsPolicy", "skillsPolicy"];

// normalizeParticipant() fills these in on save, so compare against the same defaults or every
// non-pi participant reports a phantom skillsPolicy change.
const PRESET_FIELD_DEFAULTS = { toolsPolicy: "workspace-write", skillsPolicy: "default" };

function presetFieldValue(field, source) {
  const value = source?.[field];
  if (value === undefined || value === null || value === "") return PRESET_FIELD_DEFAULTS[field];
  return value;
}

export function presetForParticipant(participant) {
  return participant?.preset ? getPreset(participant.preset) : null;
}

// True when the entry names a preset the catalog no longer carries (e.g. the GPT 5.5 presets
// retired in 1.7.0). Those stay pinned to what they were created with — sync never touches them.
export function isOrphanedPreset(participant) {
  return Boolean(participant?.preset) && !getPreset(participant.preset);
}

export function presetDrift(participant) {
  const preset = presetForParticipant(participant);
  if (!preset) return [];
  const changes = [];
  for (const field of PRESET_OWNED_FIELDS) {
    const from = presetFieldValue(field, participant);
    const to = presetFieldValue(field, preset);
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}

export function syncParticipantWithPreset(participant) {
  const changes = presetDrift(participant);
  if (changes.length === 0) return { participant, changes };
  const synced = { ...participant };
  for (const { field, to } of changes) {
    if (to === undefined) delete synced[field];
    else synced[field] = to;
  }
  return { participant: synced, changes };
}

export function driftedParticipants(participants) {
  return (participants ?? []).filter((participant) => presetDrift(participant).length > 0);
}

function stringOverride(value) {
  if (value === undefined || value === null || value === true) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function allowedOverrides(overrides) {
  const result = {};
  for (const key of ["cwd", "description"]) {
    if (overrides[key] !== undefined) result[key] = overrides[key];
  }
  return result;
}

export function formatPresetLine(preset) {
  const effort = preset.effort ? ` effort=${preset.effort}` : preset.thinking ? ` thinking=${preset.thinking}` : "";
  const skills = preset.kind === "pi" ? ` skills=${preset.skillsPolicy ?? "default"}` : "";
  return `- ${preset.preset} → @${preset.id} (${preset.name}): ${preset.label} [${preset.kind} model=${preset.model}${effort}${skills}]`;
}

export function formatPresets() {
  return ["# ConsensFlow participant presets", "", ...PARTICIPANT_PRESETS.map(formatPresetLine), "", "Add one with `/consensflow:participants add <preset>`, or `/consensflow:participants add all`."].join("\n");
}

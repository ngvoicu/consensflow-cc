import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./lib/engines.mjs", () => ({
  checkEngine: vi.fn(),
  invokeEngine: vi.fn(),
  ENGINE_CONFIGS: {
    codex: { binary: "codex" },
    opencode: { binary: "opencode" },
    gemini: { binary: "gemini" },
    claude: { binary: null },
  },
}));

vi.mock("./lib/config.mjs", () => ({
  loadTeamConfig: vi.fn(),
  listTeams: vi.fn(),
  resolveTeam: vi.fn(),
}));

vi.mock("./lib/state.mjs", () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
  addDiscussion: vi.fn(),
  addTurn: vi.fn(),
  getDiscussion: vi.fn(),
  getStatePath: vi.fn(),
}));

vi.mock("./lib/prompts.mjs", () => ({
  interpolateTemplate: vi.fn(),
  loadPromptTemplate: vi.fn(),
}));

const { handleCommand, normalizeTimeout } = await import("./consensflow-companion.mjs");

describe("handleCommand (dispatcher)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes "setup" subcommand to setup handler', async () => {
    const { checkEngine } = await import("./lib/engines.mjs");
    checkEngine.mockReturnValue({ available: true, version: "1.0", engine: "codex" });

    const result = handleCommand({ subcommand: "setup", flags: {}, positional: [] });

    expect(result).toHaveProperty("engines");
    expect(checkEngine).toHaveBeenCalled();
  });

  it('routes "invoke" subcommand to invoke handler', async () => {
    const { invokeEngine } = await import("./lib/engines.mjs");
    invokeEngine.mockReturnValue({ status: "completed", stdout: "response", engine: "codex" });

    const result = handleCommand({
      subcommand: "invoke",
      flags: { agent: "atlas", engine: "codex", model: "gpt-5.4" },
      positional: ["explain this code"],
    });

    expect(result).toHaveProperty("status");
    expect(invokeEngine).toHaveBeenCalled();
  });

  it("invoke passes timeout as seconds converted to ms by default", async () => {
    const { invokeEngine } = await import("./lib/engines.mjs");
    invokeEngine.mockReturnValue({ status: "completed", stdout: "", engine: "codex" });

    handleCommand({
      subcommand: "invoke",
      flags: { agent: "atlas", engine: "codex", model: "gpt-5.4", timeout: "120" },
      positional: ["go"],
    });

    // "120" is interpreted as 120 seconds → 120_000 ms.
    expect(invokeEngine).toHaveBeenCalledWith(
      "codex", "gpt-5.4", "go",
      expect.objectContaining({ timeout: 120_000 })
    );
  });

  it("invoke passes timeout with ms suffix as literal ms", async () => {
    const { invokeEngine } = await import("./lib/engines.mjs");
    invokeEngine.mockReturnValue({ status: "completed", stdout: "", engine: "codex" });

    handleCommand({
      subcommand: "invoke",
      flags: { agent: "atlas", engine: "codex", model: "gpt-5.4", timeout: "500ms" },
      positional: ["go"],
    });

    expect(invokeEngine).toHaveBeenCalledWith(
      "codex", "gpt-5.4", "go",
      expect.objectContaining({ timeout: 500 })
    );
  });

  it('routes "check" subcommand to check handler', async () => {
    const { checkEngine } = await import("./lib/engines.mjs");
    checkEngine.mockReturnValue({ available: true, version: "0.118.0", engine: "codex" });

    const result = handleCommand({
      subcommand: "check",
      flags: { engine: "codex" },
      positional: [],
    });

    expect(result.available).toBe(true);
    expect(result.engine).toBe("codex");
  });

  it('routes "team" subcommand to team handler', async () => {
    const { listTeams } = await import("./lib/config.mjs");
    listTeams.mockReturnValue(["product-team", "review-team"]);

    const result = handleCommand({ subcommand: "team", flags: {}, positional: [] });

    expect(result).toHaveProperty("teams");
    expect(result.teams).toEqual(["product-team", "review-team"]);
  });

  it("returns error for unknown subcommand", () => {
    const result = handleCommand({ subcommand: "unknown", flags: {}, positional: [] });

    expect(result).toHaveProperty("error");
    expect(result.error).toContain("Unknown");
  });

  it("returns error for no subcommand", () => {
    const result = handleCommand({ subcommand: null, flags: {}, positional: [] });

    expect(result).toHaveProperty("error");
  });

  it("invoke returns error when missing engine/model flags", () => {
    const result = handleCommand({
      subcommand: "invoke",
      flags: { agent: "atlas" },
      positional: ["do something"],
    });

    expect(result).toHaveProperty("error");
    expect(result.error).toContain("engine");
  });

  it("invoke returns native status for claude engine", async () => {
    const { invokeEngine } = await import("./lib/engines.mjs");
    invokeEngine.mockReturnValue(null); // Claude is native

    const result = handleCommand({
      subcommand: "invoke",
      flags: { agent: "atlas", engine: "claude", model: "opus" },
      positional: ["think"],
    });

    expect(result.status).toBe("native");
    expect(result.engine).toBe("claude");
    expect(result.agent).toBe("atlas");
  });

  it("delegate invokes engine with write flag", async () => {
    const { invokeEngine } = await import("./lib/engines.mjs");
    invokeEngine.mockReturnValue({ status: "completed", stdout: "implemented", engine: "codex" });

    const result = handleCommand({
      subcommand: "delegate",
      flags: { agent: "forge", engine: "codex", model: "gpt-5.4" },
      positional: ["implement the auth module"],
    });

    expect(result.status).toBe("completed");
    expect(result.agent).toBe("forge");
    expect(invokeEngine).toHaveBeenCalledWith(
      "codex", "gpt-5.4", "implement the auth module",
      expect.objectContaining({ write: true })
    );
  });

  it("delegate returns error when missing engine/model", () => {
    const result = handleCommand({
      subcommand: "delegate",
      flags: { agent: "forge" },
      positional: ["implement something"],
    });

    expect(result).toHaveProperty("error");
  });

  it("check returns error when missing engine flag", () => {
    const result = handleCommand({ subcommand: "check", flags: {}, positional: [] });
    expect(result).toHaveProperty("error");
  });

  it("team with unknown action returns error", () => {
    const result = handleCommand({ subcommand: "team", flags: {}, positional: ["bogus"] });
    expect(result).toHaveProperty("error");
  });

  it("team show returns team config", async () => {
    const { loadTeamConfig } = await import("./lib/config.mjs");
    loadTeamConfig.mockReturnValue({ name: "product-team", agents: ["atlas"] });

    const result = handleCommand({
      subcommand: "team",
      flags: { team: "product-team" },
      positional: ["show"],
    });

    expect(result.name).toBe("product-team");
  });

  it("team show returns error when team not found", async () => {
    const { loadTeamConfig } = await import("./lib/config.mjs");
    loadTeamConfig.mockImplementation(() => { throw new Error("Team \"missing\" not found"); });

    const result = handleCommand({
      subcommand: "team",
      flags: { team: "missing" },
      positional: ["show"],
    });

    expect(result).toHaveProperty("error");
  });

  it("state load returns current state", async () => {
    const { loadState } = await import("./lib/state.mjs");
    loadState.mockReturnValue({ version: 1, discussions: [] });

    const result = handleCommand({ subcommand: "state", flags: {}, positional: ["load"] });

    expect(result.version).toBe(1);
    expect(result.discussions).toEqual([]);
  });

  it("state start-discussion persists a new discussion", async () => {
    const { loadState, saveState, addDiscussion } = await import("./lib/state.mjs");
    loadState.mockReturnValue({ version: 1, discussions: [] });
    const fresh = {
      version: 1,
      discussions: [{ id: "disc-1", topic: "use oslo?", agents: ["atlas", "athena"], turns: [] }],
    };
    addDiscussion.mockReturnValue(fresh);

    const result = handleCommand({
      subcommand: "state",
      flags: { topic: "use oslo?", agents: "atlas,athena" },
      positional: ["start-discussion"],
    });

    expect(addDiscussion).toHaveBeenCalledWith(
      expect.any(Object),
      "use oslo?",
      ["atlas", "athena"]
    );
    expect(saveState).toHaveBeenCalledWith(expect.any(String), fresh);
    expect(result.discussion.id).toBe("disc-1");
  });

  it("state start-discussion errors without topic", () => {
    const result = handleCommand({
      subcommand: "state",
      flags: {},
      positional: ["start-discussion"],
    });
    expect(result).toHaveProperty("error");
  });

  it("state add-turn appends to an existing discussion", async () => {
    const { loadState, saveState, addTurn } = await import("./lib/state.mjs");
    loadState.mockReturnValue({ version: 1, discussions: [{ id: "disc-1", turns: [] }] });
    addTurn.mockReturnValue({
      version: 1,
      discussions: [{ id: "disc-1", turns: [{ agent: "atlas" }] }],
    });

    const result = handleCommand({
      subcommand: "state",
      flags: { discussion: "disc-1", agent: "atlas", engine: "codex", model: "gpt-5.4" },
      positional: ["add-turn", "I think we should use oslo"],
    });

    expect(addTurn).toHaveBeenCalled();
    expect(saveState).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.turn.agent).toBe("atlas");
  });

  it("state add-turn errors when discussion missing", async () => {
    const { loadState, addTurn } = await import("./lib/state.mjs");
    loadState.mockReturnValue({ version: 1, discussions: [] });
    addTurn.mockImplementation(() => { throw new Error("Discussion \"disc-x\" not found"); });

    const result = handleCommand({
      subcommand: "state",
      flags: { discussion: "disc-x" },
      positional: ["add-turn", "hi"],
    });

    expect(result).toHaveProperty("error");
  });

  it("state set-consensus updates the discussion", async () => {
    const { loadState, saveState, getDiscussion } = await import("./lib/state.mjs");
    loadState.mockReturnValue({
      version: 1,
      discussions: [{ id: "disc-1", consensus: null }],
    });
    getDiscussion.mockReturnValue({ id: "disc-1" });

    const result = handleCommand({
      subcommand: "state",
      flags: { discussion: "disc-1" },
      positional: ["set-consensus", "ship", "it"],
    });

    expect(saveState).toHaveBeenCalled();
    expect(result).toEqual({ ok: true, discussionId: "disc-1" });
  });

  it("state show returns the discussion", async () => {
    const { loadState, getDiscussion } = await import("./lib/state.mjs");
    loadState.mockReturnValue({ version: 1, discussions: [] });
    getDiscussion.mockReturnValue({ id: "disc-1", topic: "x" });

    const result = handleCommand({
      subcommand: "state",
      flags: { discussion: "disc-1" },
      positional: ["show"],
    });

    expect(result.id).toBe("disc-1");
  });

  it("prompt renders a template with variables", async () => {
    const { loadPromptTemplate, interpolateTemplate } = await import("./lib/prompts.mjs");
    loadPromptTemplate.mockReturnValue("Hello {{NAME}}");
    interpolateTemplate.mockReturnValue("Hello Atlas");
    process.env.CLAUDE_PLUGIN_ROOT = "/plugin";

    const result = handleCommand({
      subcommand: "prompt",
      flags: { name: "agent-briefing", vars: JSON.stringify({ NAME: "Atlas" }) },
      positional: [],
    });

    expect(loadPromptTemplate).toHaveBeenCalledWith("/plugin", "agent-briefing");
    expect(interpolateTemplate).toHaveBeenCalledWith("Hello {{NAME}}", { NAME: "Atlas" });
    expect(result.rendered).toBe("Hello Atlas");
  });

  it("prompt errors on missing CLAUDE_PLUGIN_ROOT", () => {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const result = handleCommand({
      subcommand: "prompt",
      flags: { name: "x" },
      positional: [],
    });
    expect(result).toHaveProperty("error");
  });

  it("prompt errors on missing name", () => {
    process.env.CLAUDE_PLUGIN_ROOT = "/plugin";
    const result = handleCommand({
      subcommand: "prompt",
      flags: {},
      positional: [],
    });
    expect(result).toHaveProperty("error");
  });

  it("prompt errors on invalid JSON vars", () => {
    process.env.CLAUDE_PLUGIN_ROOT = "/plugin";
    const result = handleCommand({
      subcommand: "prompt",
      flags: { name: "x", vars: "{not json" },
      positional: [],
    });
    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(/valid JSON/i);
  });
});

describe("normalizeTimeout", () => {
  it("returns undefined for empty input", () => {
    expect(normalizeTimeout(undefined)).toBeUndefined();
    expect(normalizeTimeout(null)).toBeUndefined();
    expect(normalizeTimeout("")).toBeUndefined();
  });

  it("treats bare numbers as seconds", () => {
    expect(normalizeTimeout("120")).toBe(120_000);
    expect(normalizeTimeout("1.5")).toBe(1500);
  });

  it("honors explicit unit suffixes", () => {
    expect(normalizeTimeout("500ms")).toBe(500);
    expect(normalizeTimeout("30s")).toBe(30_000);
    expect(normalizeTimeout("2m")).toBe(120_000);
  });

  it("returns undefined for unparseable input", () => {
    expect(normalizeTimeout("forever")).toBeUndefined();
    expect(normalizeTimeout("10h")).toBeUndefined();
  });
});

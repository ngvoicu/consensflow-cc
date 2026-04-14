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

const { handleCommand } = await import("./consensflow-companion.mjs");

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
});

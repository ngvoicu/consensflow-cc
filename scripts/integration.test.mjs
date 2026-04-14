import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external dependencies at the lowest level
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    appendFileSync: vi.fn(),
  },
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import fs from "node:fs";

describe("Integration: setup -> check -> invoke flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.CLAUDE_PLUGIN_DATA = "/tmp/test-data";
  });

  it("setup detects engines and invoke returns response", async () => {
    // Setup: codex available, gemini available, opencode missing
    spawnSync.mockImplementation((cmd, args) => {
      if (cmd === "codex" && args[0] === "--version") {
        return { status: 0, stdout: "codex-cli 0.118.0\n", stderr: "", error: null };
      }
      if (cmd === "gemini" && args[0] === "--version") {
        return { status: 0, stdout: "0.34.0\n", stderr: "", error: null };
      }
      if (cmd === "opencode" && args[0] === "--version") {
        return { status: null, stdout: "", stderr: "", error: { code: "ENOENT" } };
      }
      // Engine invocation
      if (cmd === "codex" && args[0] === "exec") {
        return { status: 0, stdout: "I recommend oslo for auth.", stderr: "", error: null, signal: null };
      }
      return { status: 1, stdout: "", stderr: "unknown", error: null };
    });

    const { handleCommand } = await import("./consensflow-companion.mjs");

    // Step 1: Setup
    const setupResult = handleCommand({ subcommand: "setup", flags: {}, positional: [] });
    expect(setupResult.engines).toHaveLength(4);

    const codex = setupResult.engines.find((e) => e.engine === "codex");
    expect(codex.available).toBe(true);

    const opencode = setupResult.engines.find((e) => e.engine === "opencode");
    expect(opencode.available).toBe(false);

    const claude = setupResult.engines.find((e) => e.engine === "claude");
    expect(claude.available).toBe(true);
    expect(claude.version).toBe("native");

    // Step 2: Invoke
    const invokeResult = handleCommand({
      subcommand: "invoke",
      flags: { agent: "atlas", engine: "codex", model: "gpt-5.4" },
      positional: ["should we use oslo or lucia for auth?"],
    });
    expect(invokeResult.status).toBe("completed");
    expect(invokeResult.stdout).toContain("oslo");
    expect(invokeResult.agent).toBe("atlas");
  });

  it("multi-agent sequential invocation collects all responses", async () => {
    let callCount = 0;
    spawnSync.mockImplementation((cmd, args) => {
      if (args[0] === "--version") {
        return { status: 0, stdout: "1.0\n", stderr: "", error: null };
      }
      callCount++;
      return {
        status: 0,
        stdout: `Agent ${callCount} response`,
        stderr: "",
        error: null,
        signal: null,
      };
    });

    const { handleCommand } = await import("./consensflow-companion.mjs");

    const agents = [
      { name: "atlas", engine: "codex", model: "gpt-5.4" },
      { name: "athena", engine: "gemini", model: "gemini-2.5-pro" },
    ];

    const responses = agents.map((a) =>
      handleCommand({
        subcommand: "invoke",
        flags: { agent: a.name, engine: a.engine, model: a.model },
        positional: ["review the auth module"],
      })
    );

    expect(responses).toHaveLength(2);
    expect(responses[0].status).toBe("completed");
    expect(responses[1].status).toBe("completed");
    expect(responses[0].agent).toBe("atlas");
    expect(responses[1].agent).toBe("athena");
  });

  it("partial failure still returns other responses", async () => {
    spawnSync.mockImplementation((cmd, args) => {
      if (args[0] === "--version") {
        return { status: 0, stdout: "1.0\n", stderr: "", error: null };
      }
      if (cmd === "codex") {
        return { status: 0, stdout: "codex response", stderr: "", error: null, signal: null };
      }
      // gemini fails
      return { status: 1, stdout: "", stderr: "auth error", error: null, signal: null };
    });

    const { handleCommand } = await import("./consensflow-companion.mjs");

    const codexResult = handleCommand({
      subcommand: "invoke",
      flags: { agent: "forge", engine: "codex", model: "gpt-5.4" },
      positional: ["implement auth"],
    });

    const geminiResult = handleCommand({
      subcommand: "invoke",
      flags: { agent: "athena", engine: "gemini", model: "gemini-2.5-pro" },
      positional: ["implement auth"],
    });

    expect(codexResult.status).toBe("completed");
    expect(geminiResult.status).toBe("failed");
    // Both returned — discussion continues
  });

  it("team config loads and resolves agent list", async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(["product-team.json"]);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      name: "product-team",
      agents: ["atlas", "athena", "forge"],
      defaults: { timeout: 120 },
    }));

    const { handleCommand } = await import("./consensflow-companion.mjs");

    const listResult = handleCommand({ subcommand: "team", flags: {}, positional: ["list"] });
    expect(listResult.teams).toContain("product-team");

    const showResult = handleCommand({ subcommand: "team", flags: { team: "product-team" }, positional: ["show"] });
    expect(showResult.name).toBe("product-team");
    expect(showResult.agents).toEqual(["atlas", "athena", "forge"]);
  });

  it("state persists discussion across calls", async () => {
    fs.existsSync.mockReturnValue(false); // No existing state

    const { loadState, addDiscussion, addTurn } = await import("./lib/state.mjs");

    let state = loadState("/test/project");
    expect(state.discussions).toHaveLength(0);

    state = addDiscussion(state, "oslo vs lucia", ["atlas", "athena"]);
    expect(state.discussions).toHaveLength(1);

    const discId = state.discussions[0].id;
    state = addTurn(state, discId, {
      agent: "atlas", engine: "codex", model: "gpt-5.4",
      position: "oslo", timestamp: new Date().toISOString(),
    });

    expect(state.discussions[0].turns).toHaveLength(1);
    expect(state.discussions[0].turns[0].agent).toBe("atlas");
  });
});

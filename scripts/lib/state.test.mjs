import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(),
  },
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
}));

const { loadState, saveState, addDiscussion, addTurn, getDiscussion, pruneState, getStatePath } = await import("./state.mjs");

describe("loadState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLAUDE_PLUGIN_DATA = "/tmp/plugin-data";
  });

  it("returns default state when file missing", () => {
    fs.existsSync.mockReturnValue(false);

    const state = loadState("/project/root");

    expect(state.version).toBe(1);
    expect(state.discussions).toEqual([]);
  });

  it("reads and parses existing state.json", () => {
    const stored = { version: 1, discussions: [{ id: "disc-1", topic: "test" }] };
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(stored));

    const state = loadState("/project/root");

    expect(state.discussions).toHaveLength(1);
    expect(state.discussions[0].id).toBe("disc-1");
  });
});

describe("saveState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLAUDE_PLUGIN_DATA = "/tmp/plugin-data";
  });

  it("writes JSON to correct path", () => {
    fs.mkdirSync.mockReturnValue(undefined);

    const state = { version: 1, discussions: [] };
    saveState("/project/root", state);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("state.json"),
      JSON.stringify(state, null, 2),
      "utf8"
    );
  });
});

describe("addDiscussion", () => {
  it("creates new discussion entry with id and timestamp", () => {
    const state = { version: 1, discussions: [] };

    const updated = addDiscussion(state, "should we use oslo?", ["atlas", "athena"]);

    expect(updated.discussions).toHaveLength(1);
    const disc = updated.discussions[0];
    expect(disc.id).toMatch(/^disc-/);
    expect(disc.topic).toBe("should we use oslo?");
    expect(disc.agents).toEqual(["atlas", "athena"]);
    expect(disc.turns).toEqual([]);
    expect(disc.timestamp).toBeTruthy();
  });
});

describe("addTurn", () => {
  it("appends turn to existing discussion", () => {
    const state = {
      version: 1,
      discussions: [{ id: "disc-1", topic: "test", turns: [], agents: ["atlas"] }],
    };

    const turn = { agent: "atlas", engine: "codex", model: "gpt-5.4", position: "I agree", timestamp: "2026-04-13" };
    const updated = addTurn(state, "disc-1", turn);

    expect(updated.discussions[0].turns).toHaveLength(1);
    expect(updated.discussions[0].turns[0].agent).toBe("atlas");
  });

  it("throws when discussion not found", () => {
    const state = { version: 1, discussions: [] };
    const turn = { agent: "atlas" };

    expect(() => addTurn(state, "disc-missing", turn)).toThrow(/not found/i);
  });
});

describe("getDiscussion", () => {
  it("retrieves by id", () => {
    const state = {
      version: 1,
      discussions: [
        { id: "disc-1", topic: "first" },
        { id: "disc-2", topic: "second" },
      ],
    };

    const disc = getDiscussion(state, "disc-2");
    expect(disc.topic).toBe("second");
  });

  it("returns null when not found", () => {
    const state = { version: 1, discussions: [] };
    expect(getDiscussion(state, "disc-nope")).toBeNull();
  });
});

describe("pruneState", () => {
  it("removes discussions older than threshold", () => {
    const old = new Date(Date.now() - 100000).toISOString();
    const recent = new Date().toISOString();

    const state = {
      version: 1,
      discussions: [
        { id: "disc-old", timestamp: old },
        { id: "disc-new", timestamp: recent },
      ],
    };

    const pruned = pruneState(state, 50000);

    expect(pruned.discussions).toHaveLength(1);
    expect(pruned.discussions[0].id).toBe("disc-new");
  });
});

describe("getStatePath", () => {
  beforeEach(() => {
    process.env.CLAUDE_PLUGIN_DATA = "/tmp/plugin-data";
  });

  it("uses CLAUDE_PLUGIN_DATA with workspace hash", () => {
    const p = getStatePath("/project/root");
    expect(p).toContain("/tmp/plugin-data/state/");
    expect(p).toContain("state.json");
  });

  it("produces different paths for different workspaces", () => {
    const p1 = getStatePath("/project/one");
    const p2 = getStatePath("/project/two");
    expect(p1).not.toBe(p2);
  });
});

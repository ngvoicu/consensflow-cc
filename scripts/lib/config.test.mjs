import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    existsSync: vi.fn(),
  },
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
}));

const { loadTeamConfig, listTeams, resolveTeam, assertSafeTeamName } = await import("./config.mjs");

const TEAMS_DIR = path.join(os.homedir(), ".config", "consensflow-cc", "teams");

describe("loadTeamConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads and parses valid JSON team config", () => {
    const config = { name: "product-team", agents: ["atlas", "athena"], defaults: { timeout: 120 } };
    fs.readFileSync.mockReturnValue(JSON.stringify(config));

    const result = loadTeamConfig("product-team");

    expect(result).toEqual(config);
    expect(fs.readFileSync).toHaveBeenCalledWith(
      path.join(TEAMS_DIR, "product-team.json"),
      "utf8"
    );
  });

  it("throws on missing file with descriptive error", () => {
    fs.readFileSync.mockImplementation(() => {
      const err = new Error("ENOENT: no such file");
      err.code = "ENOENT";
      throw err;
    });

    expect(() => loadTeamConfig("missing-team")).toThrow(/not found/i);
  });

  it("throws on invalid JSON with parse error", () => {
    fs.readFileSync.mockReturnValue("{ invalid json }}}");

    expect(() => loadTeamConfig("bad-team")).toThrow();
  });

  it("validates required fields — name and agents array", () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ name: "test" }));
    expect(() => loadTeamConfig("test")).toThrow(/agents/i);

    fs.readFileSync.mockReturnValue(JSON.stringify({ agents: ["a"] }));
    expect(() => loadTeamConfig("test")).toThrow(/name/i);

    fs.readFileSync.mockReturnValue(JSON.stringify({ name: "test", agents: "not-array" }));
    expect(() => loadTeamConfig("test")).toThrow(/agents.*array/i);
  });
});

describe("listTeams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads directory and returns team names without extension", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(["product-team.json", "review-team.json", ".DS_Store"]);

    const teams = listTeams();

    expect(teams).toEqual(["product-team", "review-team"]);
  });

  it("returns empty array when config dir missing", () => {
    fs.existsSync.mockReturnValue(false);

    const teams = listTeams();

    expect(teams).toEqual([]);
  });
});

describe("resolveTeam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the only team when one exists and no name specified", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(["solo-team.json"]);
    fs.readFileSync.mockReturnValue(JSON.stringify({ name: "solo-team", agents: ["atlas"] }));

    const result = resolveTeam();

    expect(result.name).toBe("solo-team");
  });

  it("returns named team when name specified", () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ name: "product-team", agents: ["atlas", "athena"] }));

    const result = resolveTeam("product-team");

    expect(result.name).toBe("product-team");
  });

  it("throws when multiple teams exist and no name specified", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(["team-a.json", "team-b.json"]);

    expect(() => resolveTeam()).toThrow(/multiple teams/i);
  });

  it("throws when no teams exist and no name specified", () => {
    fs.existsSync.mockReturnValue(false);

    expect(() => resolveTeam()).toThrow(/no teams/i);
  });
});

describe("assertSafeTeamName", () => {
  it("accepts safe names", () => {
    expect(() => assertSafeTeamName("product-team")).not.toThrow();
    expect(() => assertSafeTeamName("review_team.v2")).not.toThrow();
    expect(() => assertSafeTeamName("a")).not.toThrow();
  });

  it("rejects path-traversal attempts", () => {
    expect(() => assertSafeTeamName("../../evil")).toThrow(/invalid team name/i);
    expect(() => assertSafeTeamName("foo/bar")).toThrow(/invalid team name/i);
    expect(() => assertSafeTeamName("foo\\bar")).toThrow(/invalid team name/i);
    expect(() => assertSafeTeamName("")).toThrow(/invalid team name/i);
    expect(() => assertSafeTeamName(".hidden")).toThrow(/invalid team name/i);
  });

  it("rejects non-string input", () => {
    expect(() => assertSafeTeamName(null)).toThrow(/invalid team name/i);
    expect(() => assertSafeTeamName(undefined)).toThrow(/invalid team name/i);
    expect(() => assertSafeTeamName(42)).toThrow(/invalid team name/i);
  });
});

describe("loadTeamConfig — path safety", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses to read a traversal-style team name", () => {
    expect(() => loadTeamConfig("../../evil")).toThrow(/invalid team name/i);
    // Must NOT have touched the filesystem.
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });
});

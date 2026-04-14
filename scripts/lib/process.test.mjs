import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

// Import after mock setup
const { binaryAvailable, runCommand } = await import("./process.mjs");

describe("binaryAvailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns available with version when binary exists", () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: "codex-cli 0.118.0\n",
      stderr: "",
      error: null,
    });

    const result = binaryAvailable("codex", ["--version"]);

    expect(result.available).toBe(true);
    expect(result.version).toBe("codex-cli 0.118.0");
    expect(spawnSync).toHaveBeenCalledWith("codex", ["--version"], expect.objectContaining({
      encoding: "utf8",
    }));
  });

  it("returns unavailable when binary is missing", () => {
    spawnSync.mockReturnValue({
      status: null,
      stdout: "",
      stderr: "",
      error: { code: "ENOENT" },
    });

    const result = binaryAvailable("nonexistent", ["--version"]);

    expect(result.available).toBe(false);
    expect(result.version).toBeNull();
  });

  it("returns unavailable when binary exits non-zero", () => {
    spawnSync.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "command not found",
      error: null,
    });

    const result = binaryAvailable("broken", ["--version"]);

    expect(result.available).toBe(false);
  });
});

describe("runCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wraps spawnSync and returns structured result", () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: "hello world\n",
      stderr: "",
      error: null,
    });

    const result = runCommand("echo", ["hello", "world"]);

    expect(result.stdout).toBe("hello world\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
    expect(spawnSync).toHaveBeenCalledWith("echo", ["hello", "world"], expect.objectContaining({
      encoding: "utf8",
      stdio: "pipe",
    }));
  });

  it("respects timeout option", () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: "ok",
      stderr: "",
      error: null,
    });

    runCommand("slow", ["task"], { timeout: 5000 });

    expect(spawnSync).toHaveBeenCalledWith("slow", ["task"], expect.objectContaining({
      timeout: 5000,
    }));
  });

  it("returns error info on non-zero exit", () => {
    spawnSync.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "something failed\n",
      error: null,
    });

    const result = runCommand("failing", ["cmd"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("something failed\n");
    expect(result.error).toBeNull();
  });

  it("returns error info when process fails to spawn", () => {
    spawnSync.mockReturnValue({
      status: null,
      stdout: "",
      stderr: "",
      error: { code: "ENOENT", message: "spawn failing ENOENT" },
    });

    const result = runCommand("nonexistent", []);

    expect(result.exitCode).toBeNull();
    expect(result.error).toEqual({ code: "ENOENT", message: "spawn failing ENOENT" });
  });

  it("detects timeout from signal", () => {
    spawnSync.mockReturnValue({
      status: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
      error: null,
    });

    const result = runCommand("hanging", [], { timeout: 1000 });

    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe("SIGTERM");
  });
});

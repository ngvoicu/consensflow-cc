import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

vi.mock("node:fs", () => ({
  default: { appendFileSync: vi.fn(), existsSync: vi.fn() },
  appendFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

const { handleSessionStart, handleSessionEnd } = await import("./session-hook.mjs");

describe("handleSessionStart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLAUDE_ENV_FILE = "/tmp/env-file";
  });

  it("writes env vars to CLAUDE_ENV_FILE", () => {
    handleSessionStart({ source: "startup" });

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      "/tmp/env-file",
      expect.stringContaining("CONSENSFLOW_SESSION_ID"),
      "utf8"
    );
  });

  it("generates a CONSENSFLOW_SESSION_ID", () => {
    handleSessionStart({ source: "startup" });

    const written = fs.appendFileSync.mock.calls[0][1];
    expect(written).toMatch(/export CONSENSFLOW_SESSION_ID='[a-z0-9-]+'/);
  });

  it("handles missing CLAUDE_ENV_FILE gracefully", () => {
    delete process.env.CLAUDE_ENV_FILE;

    // Should not throw
    expect(() => handleSessionStart({ source: "startup" })).not.toThrow();
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });
});

describe("handleSessionEnd", () => {
  it("handles gracefully (no-op for v1)", () => {
    expect(() => handleSessionEnd({})).not.toThrow();
  });
});

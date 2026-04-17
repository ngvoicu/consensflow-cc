import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./process.mjs", () => ({
  binaryAvailable: vi.fn(),
  runCommand: vi.fn(),
}));

// ---- Engine Configuration Tests (TEST-CF-03) ----

describe("ENGINE_CONFIGS", () => {
  let ENGINE_CONFIGS;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./engines.mjs");
    ENGINE_CONFIGS = mod.ENGINE_CONFIGS;
  });

  it("has entries for codex, opencode, gemini, claude", () => {
    expect(ENGINE_CONFIGS).toHaveProperty("codex");
    expect(ENGINE_CONFIGS).toHaveProperty("opencode");
    expect(ENGINE_CONFIGS).toHaveProperty("gemini");
    expect(ENGINE_CONFIGS).toHaveProperty("claude");
  });

  it("codex buildArgs produces correct args (read)", () => {
    const args = ENGINE_CONFIGS.codex.buildArgs("gpt-5.4", "explain this code");
    expect(args).toEqual(["exec", "--model", "gpt-5.4", "explain this code"]);
  });

  it("codex write flag is placed BEFORE the prompt positional", () => {
    const args = ENGINE_CONFIGS.codex.buildArgs("gpt-5.4", "do it", { write: true });
    expect(args).toEqual(["exec", "--model", "gpt-5.4", "--full-auto", "do it"]);
    // The prompt must be the LAST arg so codex's parser treats it as positional.
    expect(args[args.length - 1]).toBe("do it");
  });

  it("opencode buildArgs produces correct args with -m flag", () => {
    const args = ENGINE_CONFIGS.opencode.buildArgs("openrouter/google/gemini-2.5-pro", "review this");
    expect(args).toEqual(["run", "-m", "openrouter/google/gemini-2.5-pro", "review this"]);
  });

  it("opencode write flag is placed BEFORE the prompt positional", () => {
    const args = ENGINE_CONFIGS.opencode.buildArgs("m", "prompt", { write: true });
    expect(args).toEqual(["run", "-m", "m", "--dangerously-skip-permissions", "prompt"]);
  });

  it("gemini buildArgs produces correct args with -p and -m flags", () => {
    const args = ENGINE_CONFIGS.gemini.buildArgs("gemini-2.5-pro", "analyze this");
    expect(args).toEqual(["-p", "analyze this", "-m", "gemini-2.5-pro", "-o", "text"]);
  });

  it("gemini ignores the write flag (headless is read-only)", () => {
    const args = ENGINE_CONFIGS.gemini.buildArgs("m", "p", { write: true });
    expect(args).toEqual(["-p", "p", "-m", "m", "-o", "text"]);
    expect(ENGINE_CONFIGS.gemini.supportsWrite).toBe(false);
  });

  it("claude config has null binary (native engine)", () => {
    expect(ENGINE_CONFIGS.claude.binary).toBeNull();
    expect(ENGINE_CONFIGS.claude.buildArgs).toBeNull();
  });

  it("each external engine has a binary and versionArgs", () => {
    for (const name of ["codex", "opencode", "gemini"]) {
      expect(ENGINE_CONFIGS[name].binary).toBeTypeOf("string");
      expect(ENGINE_CONFIGS[name].versionArgs).toBeInstanceOf(Array);
    }
  });
});

// ---- shouldRetry classifier ----

describe("shouldRetry", () => {
  let shouldRetry;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./engines.mjs");
    shouldRetry = mod.shouldRetry;
  });

  it("does not retry on success", () => {
    expect(shouldRetry({ exitCode: 0, error: null, signal: null, stderr: "" })).toBe(false);
  });

  it("does not retry on timeout signals", () => {
    expect(shouldRetry({ exitCode: null, error: null, signal: "SIGTERM", stderr: "" })).toBe(false);
    expect(shouldRetry({ exitCode: null, error: null, signal: "SIGKILL", stderr: "" })).toBe(false);
  });

  it("does not retry on spawn errors (binary missing)", () => {
    expect(shouldRetry({ exitCode: null, error: new Error("ENOENT"), signal: null, stderr: "" })).toBe(false);
  });

  it("does not retry on permanent errors (invalid model)", () => {
    expect(shouldRetry({ exitCode: 1, error: null, signal: null, stderr: "error: model not found" })).toBe(false);
    expect(shouldRetry({ exitCode: 1, error: null, signal: null, stderr: "Unknown model 'foo'" })).toBe(false);
    expect(shouldRetry({ exitCode: 1, error: null, signal: null, stderr: "invalid api key" })).toBe(false);
    expect(shouldRetry({ exitCode: 1, error: null, signal: null, stderr: "Unauthorized" })).toBe(false);
  });

  it("retries on generic transient failures", () => {
    expect(shouldRetry({ exitCode: 1, error: null, signal: null, stderr: "connection reset" })).toBe(true);
    expect(shouldRetry({ exitCode: 2, error: null, signal: null, stderr: "" })).toBe(true);
  });
});

// ---- Engine Invocation Tests (TEST-CF-05) ----

describe("checkEngine", () => {
  let checkEngine, binaryAvailable;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const processMod = await import("./process.mjs");
    binaryAvailable = processMod.binaryAvailable;
    const mod = await import("./engines.mjs");
    checkEngine = mod.checkEngine;
  });

  it("returns available for each installed engine", () => {
    binaryAvailable.mockReturnValue({ available: true, version: "codex-cli 0.118.0" });
    const result = checkEngine("codex");
    expect(result.available).toBe(true);
    expect(result.version).toBe("codex-cli 0.118.0");
    expect(result.engine).toBe("codex");
  });

  it("returns unavailable when binary missing", () => {
    binaryAvailable.mockReturnValue({ available: false, version: null });
    const result = checkEngine("opencode");
    expect(result.available).toBe(false);
    expect(result.engine).toBe("opencode");
  });

  it("returns available for claude without checking binary", () => {
    const result = checkEngine("claude");
    expect(result.available).toBe(true);
    expect(result.version).toBe("native");
    expect(binaryAvailable).not.toHaveBeenCalled();
  });
});

describe("invokeEngine", () => {
  let invokeEngine, runCommand, DEFAULT_INVOKE_TIMEOUT_MS;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const processMod = await import("./process.mjs");
    runCommand = processMod.runCommand;
    const mod = await import("./engines.mjs");
    invokeEngine = mod.invokeEngine;
    DEFAULT_INVOKE_TIMEOUT_MS = mod.DEFAULT_INVOKE_TIMEOUT_MS;
  });

  it("calls runCommand with correct args from ENGINE_CONFIGS", () => {
    runCommand.mockReturnValue({ stdout: "response", stderr: "", exitCode: 0, error: null, signal: null });
    invokeEngine("codex", "gpt-5.4", "explain this");
    expect(runCommand).toHaveBeenCalledWith(
      "codex",
      ["exec", "--model", "gpt-5.4", "explain this"],
      expect.any(Object)
    );
  });

  it("applies DEFAULT_INVOKE_TIMEOUT_MS when no timeout is supplied", () => {
    runCommand.mockReturnValue({ stdout: "ok", stderr: "", exitCode: 0, error: null, signal: null });
    invokeEngine("codex", "gpt-5.4", "hello");
    expect(DEFAULT_INVOKE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(runCommand).toHaveBeenCalledWith(
      "codex",
      expect.any(Array),
      expect.objectContaining({ timeout: DEFAULT_INVOKE_TIMEOUT_MS })
    );
  });

  it("honors an explicit timeout in ms", () => {
    runCommand.mockReturnValue({ stdout: "ok", stderr: "", exitCode: 0, error: null, signal: null });
    invokeEngine("codex", "gpt-5.4", "hello", { timeout: 5000 });
    expect(runCommand).toHaveBeenCalledWith(
      "codex",
      expect.any(Array),
      expect.objectContaining({ timeout: 5000 })
    );
  });

  it("places write flag before the prompt positional for codex", () => {
    runCommand.mockReturnValue({ stdout: "ok", stderr: "", exitCode: 0, error: null, signal: null });
    invokeEngine("codex", "gpt-5.4", "refactor auth", { write: true });
    expect(runCommand).toHaveBeenCalledWith(
      "codex",
      ["exec", "--model", "gpt-5.4", "--full-auto", "refactor auth"],
      expect.any(Object)
    );
  });

  it("returns structured response on success", () => {
    runCommand.mockReturnValue({ stdout: "analysis done", stderr: "", exitCode: 0, error: null, signal: null });
    const result = invokeEngine("gemini", "gemini-2.5-pro", "analyze");
    expect(result.engine).toBe("gemini");
    expect(result.model).toBe("gemini-2.5-pro");
    expect(result.status).toBe("completed");
    expect(result.stdout).toBe("analysis done");
    expect(result.durationMs).toBeTypeOf("number");
  });

  it("does NOT retry on permanent failure (model not found)", () => {
    runCommand.mockReturnValue({ stdout: "", stderr: "model not found", exitCode: 1, error: null, signal: null });
    const result = invokeEngine("codex", "bad-model", "test");
    expect(result.status).toBe("failed");
    expect(result.stderr).toBe("model not found");
    // Classified as permanent — exactly ONE call.
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("returns status timeout when command is killed", () => {
    runCommand.mockReturnValue({ stdout: "", stderr: "", exitCode: null, error: null, signal: "SIGTERM" });
    const result = invokeEngine("opencode", "openrouter/google/gemini-2.5-pro", "slow task", { timeout: 5000 });
    expect(result.status).toBe("timeout");
    // Timeouts are not retried.
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("retries once on transient failure then returns error", () => {
    runCommand
      .mockReturnValueOnce({ stdout: "", stderr: "network error", exitCode: 1, error: null, signal: null })
      .mockReturnValueOnce({ stdout: "", stderr: "network error", exitCode: 1, error: null, signal: null });
    const result = invokeEngine("codex", "gpt-5.4", "test");
    expect(result.status).toBe("failed");
    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it("succeeds on retry if second attempt works", () => {
    runCommand
      .mockReturnValueOnce({ stdout: "", stderr: "transient error", exitCode: 1, error: null, signal: null })
      .mockReturnValueOnce({ stdout: "success", stderr: "", exitCode: 0, error: null, signal: null });
    const result = invokeEngine("codex", "gpt-5.4", "test");
    expect(result.status).toBe("completed");
    expect(result.stdout).toBe("success");
  });

  it("returns null for claude engine (native agent)", () => {
    const result = invokeEngine("claude", "opus", "think about this");
    expect(result).toBeNull();
    expect(runCommand).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

vi.mock("node:fs", () => ({
  default: { readFileSync: vi.fn() },
  readFileSync: vi.fn(),
}));

const { interpolateTemplate, loadPromptTemplate } = await import("./prompts.mjs");

describe("interpolateTemplate", () => {
  it("replaces {{KEY}} with provided values", () => {
    const result = interpolateTemplate("Hello {{NAME}}!", { NAME: "Atlas" });
    expect(result).toBe("Hello Atlas!");
  });

  it("leaves unknown keys as empty string", () => {
    const result = interpolateTemplate("{{KNOWN}} and {{UNKNOWN}}", { KNOWN: "yes" });
    expect(result).toBe("yes and ");
  });

  it("handles multiple replacements", () => {
    const template = "{{AGENT}} ({{ENGINE}}/{{MODEL}}) says: {{RESPONSE}}";
    const vars = { AGENT: "Atlas", ENGINE: "codex", MODEL: "gpt-5.4", RESPONSE: "I agree" };
    const result = interpolateTemplate(template, vars);
    expect(result).toBe("Atlas (codex/gpt-5.4) says: I agree");
  });

  it("handles template with no placeholders", () => {
    const result = interpolateTemplate("plain text", { KEY: "value" });
    expect(result).toBe("plain text");
  });
});

describe("loadPromptTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads .md file from prompts/ dir", () => {
    fs.readFileSync.mockReturnValue("# Briefing\n{{CONTEXT}}\n{{QUESTION}}");

    const template = loadPromptTemplate("/plugin/root", "agent-briefing");

    expect(fs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("prompts/agent-briefing.md"),
      "utf8"
    );
    expect(template).toContain("{{CONTEXT}}");
  });

  it("throws on missing file", () => {
    fs.readFileSync.mockImplementation(() => {
      const err = new Error("ENOENT");
      err.code = "ENOENT";
      throw err;
    });

    expect(() => loadPromptTemplate("/plugin/root", "nonexistent")).toThrow();
  });
});

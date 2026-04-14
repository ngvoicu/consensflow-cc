import { describe, it, expect } from "vitest";
import { parseArgs } from "./args.mjs";

describe("parseArgs", () => {
  it("extracts subcommand from first positional arg", () => {
    const result = parseArgs(["setup"]);
    expect(result.subcommand).toBe("setup");
  });

  it("extracts --flags with values", () => {
    const result = parseArgs(["invoke", "--agent", "atlas", "--model", "gpt-5.4"]);
    expect(result.subcommand).toBe("invoke");
    expect(result.flags.agent).toBe("atlas");
    expect(result.flags.model).toBe("gpt-5.4");
  });

  it("extracts --boolean flags", () => {
    const result = parseArgs(["invoke", "--write", "--json"]);
    expect(result.flags.write).toBe(true);
    expect(result.flags.json).toBe(true);
  });

  it("collects remaining args as positional", () => {
    const result = parseArgs(["invoke", "--agent", "atlas", "explain", "this", "code"]);
    expect(result.positional).toEqual(["explain", "this", "code"]);
  });

  it("returns empty object for no args", () => {
    const result = parseArgs([]);
    expect(result.subcommand).toBeNull();
    expect(result.flags).toEqual({});
    expect(result.positional).toEqual([]);
  });

  it("handles --agent flag (single name)", () => {
    const result = parseArgs(["invoke", "--agent", "forge"]);
    expect(result.flags.agent).toBe("forge");
  });

  it("handles --agents flag (comma-separated list)", () => {
    const result = parseArgs(["invoke", "--agents", "atlas,athena,forge"]);
    expect(result.flags.agents).toBe("atlas,athena,forge");
  });

  it("handles --team flag", () => {
    const result = parseArgs(["team", "--team", "product-team"]);
    expect(result.flags.team).toBe("product-team");
  });

  it("treats --flag at end as boolean", () => {
    const result = parseArgs(["setup", "--verbose"]);
    expect(result.flags.verbose).toBe(true);
  });

  it("handles mixed flags and positional args", () => {
    const result = parseArgs(["delegate", "--agent", "forge", "--write", "implement the auth module"]);
    expect(result.subcommand).toBe("delegate");
    expect(result.flags.agent).toBe("forge");
    expect(result.flags.write).toBe(true);
    expect(result.positional).toEqual(["implement the auth module"]);
  });
});

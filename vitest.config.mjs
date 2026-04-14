import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      include: ["scripts/**/*.mjs"],
      exclude: ["scripts/**/*.test.mjs"],
    },
  },
});

import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "evals/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
});

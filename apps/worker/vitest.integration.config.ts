import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config.js";

// Same resolve (server-only alias, D30) as the unit tests; its own test set.
export default defineConfig({
  resolve: baseConfig.resolve,
  test: {
    environment: "node",
    include: ["__tests__/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

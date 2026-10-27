import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config";

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ["__tests__/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});

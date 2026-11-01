import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@scaliahr/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    include: ["__tests__/**/*.test.ts"],
    exclude: ["**/node_modules/**", "__tests__/integration/**"],
  },
});

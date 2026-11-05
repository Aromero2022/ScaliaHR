import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web producer (lib/email) is marked server-only (D30); in tests it resolves
  // to the package's server build, which is empty.
  resolve: {
    alias: { "server-only": path.resolve(__dirname, "../../node_modules/server-only/empty.js") },
  },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    exclude: ["**/node_modules/**", "__tests__/integration/**"],
  },
});

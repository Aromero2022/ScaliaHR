import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // tsconfig keeps JSX for Next.js ("preserve"); tests that render components need it compiled (D41).
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@scaliahr/shared": path.resolve(__dirname, "../../packages/shared/src"),
      "@scaliahr/email/contract": path.resolve(__dirname, "../../packages/email/src/contract.ts"),
      // D30: Node has no react-server condition; tests load the package's empty server build.
      "server-only": path.resolve(__dirname, "../../node_modules/server-only/empty.js"),
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

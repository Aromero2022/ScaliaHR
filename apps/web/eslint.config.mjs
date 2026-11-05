import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import noServerOnlyInClient from "./eslint-rules/no-server-only-in-client.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  { ignores: [".next/**", "node_modules/**", "dist/**", "coverage/**"] },
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@prisma/client"],
              importNamePattern: ".*",
              message:
                "Import from @/lib/db/tenant-client or @/lib/db/admin-client instead of @prisma/client directly.",
            },
            {
              group: ["**/lib/db/admin-client"],
              importNamePattern: ".*",
              message:
                "admin-client can only be imported from lib/jobs/ or lib/admin/.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/lib/db/**/*.ts",
      "src/lib/jobs/**/*.ts",
      "src/lib/admin/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // D30: client components cannot reach modules marked `import "server-only"`.
    files: ["src/**/*.{ts,tsx}"],
    plugins: { scalia: { rules: { "no-server-only-in-client": noServerOnlyInClient } } },
    rules: { "scalia/no-server-only-in-client": ["error", { srcDir: join(__dirname, "src") }] },
  },
];

import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

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
];

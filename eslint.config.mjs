import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Disable formatting-related rules so Prettier is the single source of truth.
  ...compat.extends("prettier"),
  {
    ignores: [".next/**", "node_modules/**", "data/**", "next-env.d.ts"],
  },
  {
    // We navigate with plain <a> tags on purpose (full reload re-runs the
    // server-side auth/role gate on every page), so silence the Link rule.
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
];

export default eslintConfig;

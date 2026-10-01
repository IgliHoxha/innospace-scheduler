import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    // Native module: let Node require it instead of Vite trying to transform it.
    server: { deps: { external: ["better-sqlite3"] } },
  },
  // tsconfig keeps JSX for Next to compile; the tests need it compiled here.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});

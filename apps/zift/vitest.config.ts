import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * The `@/` alias, so a test can import the module a handler imports rather than
 * a relative copy of the path. tsconfig.json declares the same mapping; this is
 * what makes it true at runtime as well as to the compiler.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});

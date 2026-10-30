import { defineConfig } from "drizzle-kit";

/**
 * Referenced by `pnpm generate` (drizzle-kit) only. The migrator container
 * does not read this — it replays the committed SQL in ./drizzle via
 * src/db/migrate.ts, so generated migrations must be committed.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
});

import { z } from "zod";

/**
 * Infrastructure only. The Zift credentials are resolved by
 * `modules/zift/config.ts`, which returns a structured refusal naming what is
 * missing rather than throwing: an app that crash-loops on an absent merchant
 * credential cannot be installed, and an app that cannot be installed cannot be
 * proven.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_API_BASE_URL: z.string().url().optional(),
  /**
   * `sandbox` everywhere but the production overlay, so a misconfiguration
   * fails toward the test gateway. `mock` answers from a table instead of the
   * network — see modules/zift/mock.ts — so an environment can be clicked
   * through before Zift has issued a login.
   */
  ZIFT_ENVIRONMENT: z.enum(["production", "sandbox", "mock"]).default("sandbox"),
});

export const env = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  APP_API_BASE_URL: process.env.APP_API_BASE_URL,
  ZIFT_ENVIRONMENT: process.env.ZIFT_ENVIRONMENT,
});

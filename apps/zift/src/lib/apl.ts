import { APL, AplConfiguredResult, AplReadyResult, AuthData } from "@saleor/app-sdk/APL";
import { eq, like } from "drizzle-orm";

import { db } from "@/db";
import { ziftConfig } from "@/db/schema";

const APL_KEY_PREFIX = "apl:";

/** Postgres-backed APL, same shape as every other app's here. */
export class PostgresAPL implements APL {
  async get(saleorApiUrl: string): Promise<AuthData | undefined> {
    const row = await db
      .select()
      .from(ziftConfig)
      .where(eq(ziftConfig.key, `${APL_KEY_PREFIX}${saleorApiUrl}`))
      .limit(1);

    return row[0] ? (JSON.parse(row[0].value) as AuthData) : undefined;
  }

  async set(authData: AuthData): Promise<void> {
    const key = `${APL_KEY_PREFIX}${authData.saleorApiUrl}`;
    const value = JSON.stringify(authData);

    await db
      .insert(ziftConfig)
      .values({ key, value })
      .onConflictDoUpdate({ target: ziftConfig.key, set: { value, updatedAt: new Date() } });
  }

  async delete(saleorApiUrl: string): Promise<void> {
    await db.delete(ziftConfig).where(eq(ziftConfig.key, `${APL_KEY_PREFIX}${saleorApiUrl}`));
  }

  async getAll(): Promise<AuthData[]> {
    const rows = await db
      .select()
      .from(ziftConfig)
      .where(like(ziftConfig.key, `${APL_KEY_PREFIX}%`));

    return rows.map((row) => JSON.parse(row.value) as AuthData);
  }

  async isReady(): Promise<AplReadyResult> {
    return { ready: true };
  }

  async isConfigured(): Promise<AplConfiguredResult> {
    return { configured: true };
  }
}

export const apl = new PostgresAPL();

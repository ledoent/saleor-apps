/**
 * Where the vault token survives Saleor reusing the pspReference — and where
 * the card's expiry lives, because Zift cannot charge a token without it.
 *
 * `recordVault` runs on every stored card and `findCard` on every charge. If
 * this table is empty in an environment, no card has been stored there.
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { cardTokens } from "@/db/schema";
import { ACCOUNT_TYPE } from "./ach";
import { interpretNotice, type NocInterpretation, type NocNotification } from "./noc";

export interface VaultRecord {
  saleorTransactionId: string;
  token: string;
  /** `R` card, `C` checking, `S` savings. Defaults to a card for old callers. */
  accountType?: string;
  accountAccessory?: string | null;
  brand?: string | null;
  lastFour?: string | null;
  holderName?: string | null;
  saleorCheckoutId?: string | null;
  saleorOrderId?: string | null;
  saleorCustomerId?: string | null;
  verificationReference?: string | null;
  status: string;
}

export const recordVault = async (record: VaultRecord): Promise<void> => {
  const values = { ...record, accountType: record.accountType ?? ACCOUNT_TYPE.card };

  await db
    .insert(cardTokens)
    .values(values)
    .onConflictDoUpdate({
      target: cardTokens.saleorTransactionId,
      set: { ...values, updatedAt: new Date() },
    });
};

export const findCard = async (saleorTransactionId: string) => {
  const rows = await db
    .select()
    .from(cardTokens)
    .where(eq(cardTokens.saleorTransactionId, saleorTransactionId))
    .limit(1);

  return rows[0] ?? null;
};

/** After a successful sale, so a later refund knows what to reverse. */
export const recordCharge = async (saleorTransactionId: string, reference: string): Promise<void> => {
  await db
    .update(cardTokens)
    .set({ lastChargeReference: reference, updatedAt: new Date() })
    .where(eq(cardTokens.saleorTransactionId, saleorTransactionId));
};

export interface NocApplication {
  interpretation: NocInterpretation;
  /**
   * How many stored rows were corrected.
   *
   * Zero on an applicable notice is not success — it means the bank corrected
   * an account we do not hold under that token, and the caller must say so.
   */
  rowsUpdated: number;
}

/**
 * Apply a Notice of Change to every row holding the superseded token.
 *
 * EVERY row, not one. The same bank account can be stored against several
 * Saleor transactions — a repeat customer, or a buyer who reached checkout
 * twice — and a correction applied to one of them leaves the others carrying
 * the detail the bank has already rejected. The next debit on any of those
 * returns again.
 *
 * The match is on the token, which is what `tokenOriginal` names. Matching on a
 * Saleor id would be guessing at which stored account the bank meant.
 */
export const applyNoticeOfChange = async (
  notification: NocNotification,
): Promise<NocApplication> => {
  const interpretation = interpretNotice(notification);
  if (!interpretation.applicable) return { interpretation, rowsUpdated: 0 };

  const rows = await db
    .update(cardTokens)
    .set({
      ...interpretation.patch,
      nocLastCode: interpretation.code,
      nocLastAppliedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(cardTokens.token, interpretation.matchToken))
    .returning({ saleorTransactionId: cardTokens.saleorTransactionId });

  return { interpretation, rowsUpdated: rows.length };
};

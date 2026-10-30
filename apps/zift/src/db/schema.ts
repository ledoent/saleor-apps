import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Key/value store backing the APL. Its own table, like every other app's. */
export const ziftConfig = pgTable("zift_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * The link between a Saleor transaction and a card stored at Zift.
 *
 * It exists because Saleor carries a single `pspReference` and
 * this app needs two different values in it at different times — the vault
 * token while the card is merely stored, and the sale's transaction id once AR
 * has charged, because that is what a refund reverses.
 *
 * WHY THERE IS AN EXPIRY COLUMN AT ALL
 *
 * Zift requires `accountAccessory` — the card's expiry date — on a charge
 * **even when the card is identified by a token**. So a token alone cannot be
 * charged, and the expiry has to be kept beside it. A gateway whose vault id is
 * sufficient on its own needs no such column; Zift's is not.
 *
 * It is not sensitive on its own and it is not the card: an expiry date without
 * a PAN authorises nothing. NEVER add a column for the PAN, the CSC, or track
 * data. The CSC in particular may not be retained after authorisation under any
 * circumstances, and a schema is where that rule gets quietly broken first.
 *
 * The same rule covers bank accounts, which this table also holds since ACH was
 * added: no column for a bank account number. The routing number is not secret
 * and is needed on every debit, so it shares `accountAccessory` with the card
 * expiry — Zift uses one field for both. The account number itself only ever
 * exists as a token.
 */
export const cardTokens = pgTable("zift_card_tokens", {
  /** Saleor's transaction id. The charge webhook has this and nothing else. */
  saleorTransactionId: text("saleor_transaction_id").primaryKey(),
  /** Zift's token, String(40) in their docs. */
  token: text("token").notNull(),
  /**
   * Zift's `accountType`: `R` card, `C` bank checking, `S` bank savings.
   *
   * This is what tells a charge whether it is taking a card or debiting a bank,
   * and the two are not interchangeable — an ACH acceptance is not a payment.
   * It defaults to `R` because every row that existed before ACH was a card.
   *
   * A Notice of Change can alter it (NACHA C05/C06), which is the other reason
   * it is a column rather than something re-derived from the token.
   */
  accountType: text("account_type").notNull().default("R"),
  /** MMYY for a card, the ABA routing number for ACH. Required on every charge. */
  accountAccessory: text("account_accessory"),
  brand: text("brand"),
  lastFour: text("last_four"),
  holderName: text("holder_name"),
  saleorCheckoutId: text("saleor_checkout_id"),
  saleorOrderId: text("saleor_order_id"),
  saleorCustomerId: text("saleor_customer_id"),
  /** The $0 account-verification that minted the token, kept for audit. */
  verificationReference: text("verification_reference"),
  /** established | revoked */
  status: text("status").notNull().default("established"),
  /** The most recent sale, so a refund knows what to reverse. */
  lastChargeReference: text("last_charge_reference"),
  /**
   * The last Notice of Change applied to this row, and when.
   *
   * A NOC rewrites a stored payment credential, so it does not happen without a
   * record of it. When a debit returns anyway, the first question is whether the
   * detail the bank corrected is the detail we actually used.
   */
  nocLastCode: text("noc_last_code"),
  nocLastAppliedAt: timestamp("noc_last_applied_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

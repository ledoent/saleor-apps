/**
 * Storing a card: a $0 verification that returns a token.
 *
 * WHY THIS IS SHORTER THAN A $1-AUTHORISATION VAULT
 *
 * The usual way to mint a chargeable stored credential is to authorise a dollar
 * and reverse it in the same call — and most of the code in that design is
 * about the reversal failing, because a standing dollar hold on a customer's
 * card is a support call that is unrecoverable if nobody writes it down at the
 * moment it happens.
 *
 * Zift's `account-verification` does a **$0** verification and hands back a
 * token. No hold, no reversal, nothing to fail halfway. Their docs are explicit
 * that AVS results come back on it too, so the address check happens at the
 * same moment and costs nothing extra.
 *
 * WHAT MUST BE KEPT BESIDE THE TOKEN
 *
 * The expiry. Zift marks `accountAccessory` Required on a charge **even when
 * the card is identified by a token**, so a token on its own cannot be charged.
 * That is why `zift_card_tokens` has a column for it, and why this function
 * returns it rather than discarding it as display metadata.
 */

import type { Params, ZiftResponse } from "./client";
import { interpretTransaction, toSaleorResult } from "./transactions";
import { assessVerification, verificationNotice, type VerificationAssessment } from "./verification";

export interface EstablishVaultInput {
  /** The proxynization token the browser produced. Never a card number. */
  token: string;
  /** MMYY. Required by Zift on every later charge, so it is required here. */
  accountAccessory: string;
  holderName: string;
  billingStreet?: string | null;
  billingZip?: string | null;
}

export interface EstablishVaultDeps {
  /** requestType=account-verification */
  verify: (params: Params) => Promise<ZiftResponse>;
}

export interface StoredCard {
  token: string;
  accountAccessory: string;
  brand?: string | null;
  lastFour?: string | null;
  holderName?: string | null;
}

export interface EstablishVaultResult {
  result: string;
  pspReference: string;
  message?: string;
  data: Record<string, unknown>;
  card?: StoredCard;
  verification: VerificationAssessment;
}

/** Zift returns e.g. `4********5655`; the trailing four are what a human reads. */
const lastFourOf = (masked: string | undefined): string | null => {
  const digits = (masked ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
};

export const establishVaultCredential = async (
  input: EstablishVaultInput,
  deps: EstablishVaultDeps,
): Promise<EstablishVaultResult> => {
  const response = await deps.verify({
    accountType: "R",
    token: input.token,
    accountAccessory: input.accountAccessory,
    holderName: input.holderName,
    street: input.billingStreet,
    zipCode: input.billingZip,
  });

  const outcome = interpretTransaction("account-verification", response);
  const base = toSaleorResult(outcome, "AUTHORIZATION");
  const verification = assessVerification({
    avsResponse: response.avsResponseCode,
    cscResponse: response.cscResponseCode,
    approved: outcome.approved,
  });

  if (!outcome.approved) {
    return {
      ...base,
      verification,
      message: outcome.message || "Zift declined the $0 card verification.",
      data: { ...base.data, verification },
    };
  }

  // Zift may return a fresh token on the verification. Prefer it over the
  // proxynization token: their docs describe the verification token as the
  // durable one for future processing, and the browser's is transient.
  const token = response.token || input.token;

  // An approval with a failed address or security-code check used to leave
  // here as "Approved", indistinguishable from a clean one everywhere a person
  // looks. The notice rides the transaction message into the dashboard.
  const notice = verificationNotice(verification);

  return {
    ...base,
    ...(notice ? { message: notice } : {}),
    card: {
      token,
      accountAccessory: input.accountAccessory,
      brand: response.extendedAccountType ?? null,
      lastFour: lastFourOf(response.accountNumberMasked),
      holderName: response.holderName ?? input.holderName,
    },
    verification,
    data: { ...base.data, verification, verificationReference: outcome.reference },
  };
};

/**
 * AVS and CSC results from Zift.
 *
 * The argument is worth stating plainly: an approval is not a verification
 * pass. The
 * issuer can release the funds while telling us the address did not match, and
 * if nothing records that, it becomes nobody's problem until a chargeback
 * arrives. So every transaction records its verification outcome and the gap
 * between "approved" and "verified" is stated.
 *
 * Zift returns these as single-letter network codes in `avsResponseCode` and
 * `cscResponseCode`. Their docs carry full tables this app has not read; the
 * common network set is below and **anything unrecognised is `unavailable`,
 * never a pass** — processors add codes, and defaulting an unknown response to
 * "fine" is exactly how a verification failure becomes invisible.
 */

export type CscOutcome = "match" | "no_match" | "not_processed" | "unavailable";
export type AvsOutcome = "full_match" | "partial_match" | "no_match" | "unavailable" | "invalid";

interface Meaning<T> {
  outcome: T;
  description: string;
}

export const CSC_CODES: Record<string, Meaning<CscOutcome>> = {
  M: { outcome: "match", description: "Security code match" },
  N: { outcome: "no_match", description: "Security code does not match" },
  P: { outcome: "not_processed", description: "Security code not processed" },
  S: { outcome: "no_match", description: "Issuer says the code should be present; the merchant said it was not" },
  U: { outcome: "unavailable", description: "Issuer is not certified for security codes" },
  X: { outcome: "unavailable", description: "No response received from the issuer" },
};

export const AVS_CODES: Record<string, Meaning<AvsOutcome>> = {
  Y: { outcome: "full_match", description: "Street address and ZIP match" },
  D: { outcome: "full_match", description: "Street address and postal code match" },
  M: { outcome: "full_match", description: "Street address and postal code match" },
  X: { outcome: "full_match", description: "Street address and nine-digit ZIP match" },
  A: { outcome: "partial_match", description: "Street address matches; ZIP does not" },
  B: { outcome: "partial_match", description: "Street address matches; ZIP not verified" },
  W: { outcome: "partial_match", description: "Nine-digit ZIP matches; street address does not" },
  Z: { outcome: "partial_match", description: "ZIP matches; street address does not" },
  P: { outcome: "partial_match", description: "Postal code matches; street address not verified" },
  N: { outcome: "no_match", description: "Neither street address nor ZIP matches" },
  C: { outcome: "no_match", description: "Address not verified" },
  I: { outcome: "no_match", description: "Address not verified" },
  G: { outcome: "unavailable", description: "Non-US issuer does not participate in AVS" },
  S: { outcome: "unavailable", description: "Issuer does not support AVS" },
  U: { outcome: "unavailable", description: "Address information unavailable" },
  R: { outcome: "unavailable", description: "Issuer system unavailable; retry" },
  E: { outcome: "invalid", description: "AVS data is invalid" },
};

const classify = <T>(
  raw: string | null | undefined,
  codes: Record<string, Meaning<T>>,
  fallback: T,
  label: string,
): { code: string | null; outcome: T; description: string; recognised: boolean } => {
  const value = raw?.trim().toUpperCase() ?? "";
  if (!value) {
    return { code: null, outcome: fallback, description: `No ${label} response`, recognised: false };
  }
  const known = codes[value];
  if (known) return { code: value, outcome: known.outcome, description: known.description, recognised: true };
  return { code: value, outcome: fallback, description: `Unrecognised ${label} code: ${value}`, recognised: false };
};

export interface VerificationInput {
  avsResponse?: string | null;
  cscResponse?: string | null;
  approved: boolean;
}

export interface VerificationAssessment {
  avs: { code: string | null; outcome: AvsOutcome; description: string };
  csc: { code: string | null; outcome: CscOutcome; description: string };
  /** Approved by the issuer, but a verification signal failed. Worth a human. */
  approvedWithFailedVerification: boolean;
  hasUninterpretableSignal: boolean;
}

export const assessVerification = (input: VerificationInput): VerificationAssessment => {
  const avs = classify<AvsOutcome>(input.avsResponse, AVS_CODES, "unavailable", "AVS");
  const csc = classify<CscOutcome>(input.cscResponse, CSC_CODES, "unavailable", "CSC");
  const failed = avs.outcome === "no_match" || avs.outcome === "invalid" || csc.outcome === "no_match";

  return {
    avs: { code: avs.code, outcome: avs.outcome, description: avs.description },
    csc: { code: csc.code, outcome: csc.outcome, description: csc.description },
    approvedWithFailedVerification: input.approved && failed,
    hasUninterpretableSignal:
      (avs.code !== null && !avs.recognised) || (csc.code !== null && !csc.recognised),
  };
};

/**
 * The sentence a person reads when the issuer said yes and a check said no.
 *
 * It becomes the Saleor transaction's message, which is what the dashboard
 * shows beside the Charge button and what AR reads on ship day — the one place
 * a mismatch was reaching nobody. `null` when there is nothing to say: a plain
 * approval keeps the gateway's own "Approved".
 *
 * The storefront renders the same failure for the order, the review page and
 * the sales email from the assessment this app returns in the transaction's
 * `data` (`lib/payments/card-verification.ts`), not from this sentence. Two
 * deployables, no shared package; the contract between them is the shape of
 * `VerificationAssessment`, not this wording.
 */
export const verificationNotice = (v: VerificationAssessment): string | null => {
  if (!v.approvedWithFailedVerification) return null;
  const parts: string[] = [];
  if (v.avs.outcome === "no_match" || v.avs.outcome === "invalid") {
    parts.push(`billing address did not match (AVS ${v.avs.code ?? "?"}: ${v.avs.description})`);
  }
  if (v.csc.outcome === "no_match") {
    parts.push(`security code did not match (CSC ${v.csc.code ?? "?"}: ${v.csc.description})`);
  }
  return parts.length ? `Approved, but ${parts.join(" and ")}` : null;
};

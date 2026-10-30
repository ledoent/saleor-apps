/**
 * Dollars in, cents out.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * Zift takes every amount as an **integer number of cents**; Saleor hands us
 * decimal dollars. That conversion appears in the charge, the refund, the tax
 * total, the freight, and once per line item — six places in one request, each
 * of which is a chance to send $71.16 as 7115 or 7116 or 7115.5.
 *
 * TWO ROUNDING BUGS, NOT ONE
 *
 * `Math.trunc(dollars * 100)` loses a cent: 71.155 * 100 is exactly 7115.5, so
 * truncation gives 7115. That one is obvious.
 *
 * `Math.round(dollars * 100)` loses a cent too, less obviously. 0.145 * 100 is
 * 14.499999999999998 in IEEE 754 and 1.005 * 100 is 100.49999999999999, so
 * rounding gives 14 and 100 where decimal arithmetic gives 15 and 101. The
 * multiply has already destroyed the information before the rounding runs.
 *
 * `toPrecision(15)` snaps the product back to the decimal value it is trying to
 * be — a double carries about 15–17 significant digits, so 15 is inside the
 * noise floor for every amount this catalogue can produce and outside the error
 * the multiply introduced. It is not a general-purpose decimal library, and it
 * does not need to be: the largest order here is $21,499.99, which is seven
 * significant digits.
 *
 * A cent lost per line is a Level 3 record that does not reconcile, and a
 * record that does not reconcile is rejected in full.
 *
 * A gateway that accepts decimal dollars needs no equivalent of this file. Zift
 * takes integer cents, which is the most mechanical difference in porting a
 * mapper onto this API, and the easiest to get quietly wrong.
 */

/** Significant digits a double can be trusted to, for snapping off multiply error. */
const SIGNIFICANT_DIGITS = 15;

/** Decimal dollars to whole cents, half away from zero. */
export const toCents = (dollars: number | null | undefined): number => {
  if (dollars === null || dollars === undefined || !Number.isFinite(dollars)) return 0;
  if (dollars === 0) return 0;
  return Math.round(Number((dollars * 100).toPrecision(SIGNIFICANT_DIGITS)));
};

/** Cents back to dollars, for reporting an amount to Saleor. */
export const toDollars = (cents: number | null | undefined): number => {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
};

/**
 * A tax rate as Zift wants it: an integer with two implied decimal places, so
 * 1.5% is 150 and 10% is 1000.
 *
 * Derived from the amounts rather than carried alongside them, for a reason
 * every Level 3 mapper has to respect: a rate supplied independently of the
 * amounts can disagree with them after rounding, and a processor that finds
 * them inconsistent rejects the record.
 */
export const toRate = (netCents: number, taxCents: number): number => {
  if (netCents <= 0 || taxCents <= 0) return 0;
  return Math.round((taxCents / netCents) * 10000);
};

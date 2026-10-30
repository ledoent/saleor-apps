/**
 * Zift's subrecord encoding, which is not JSON and not a nested form field.
 *
 * Line items travel inside a single form parameter, as a run of
 * bracket-delimited groups whose fields are `name=value` separated by
 * semicolons:
 *
 *   items=(code=001;quantity=1;description=t-shirt;totalAmount=50000)(code=002;...)
 *
 * WHY THIS IS A MODULE AND NOT A TEMPLATE STRING
 *
 * Because of what the documentation does not say. `(`, `)`, `;` and `=` are all
 * structural, and nothing in Zift's docs defines an escape for them appearing
 * inside a value. Our descriptions are product names typed by people —
 * "Workstation (rugged); 64 GB" is an ordinary thing for a catalogue to
 * contain, and pasted into the format above it silently produces two malformed
 * items rather than one good one.
 *
 * So values are sanitised here, once, and the rule is stated rather than
 * assumed: structural characters are replaced with a space, not dropped, so a
 * description stays readable and word boundaries survive. This is deliberately
 * lossy and deliberately visible — the alternative is a Level 3 record that
 * parses into the wrong number of items and is rejected, or worse, accepted
 * with a line the cardholder cannot recognise on their statement.
 *
 * If Zift documents a real escape, replace `sanitise` and keep everything else.
 */

/** Characters that mean something to the parser and therefore cannot be data. */
const STRUCTURAL = /[()=;]/g;

/**
 * Make a value safe to place inside a subrecord.
 *
 * Collapses whitespace as well, because a newline in a product description
 * would otherwise reach the wire and Zift's field lengths are counted in
 * characters an operator would not expect to be spending on formatting.
 */
export const sanitise = (value: string): string =>
  value.replace(STRUCTURAL, " ").replace(/\s+/g, " ").trim();

export type SubrecordField = readonly [name: string, value: string | number | null | undefined];

/**
 * One subrecord. Fields with no value are omitted rather than sent empty:
 * Zift validates field formats, and an empty string is a value that fails a
 * format check where an absent field simply is not there.
 */
export const encodeSubrecord = (fields: readonly SubrecordField[]): string => {
  const parts = fields
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([name, value]) => `${name}=${sanitise(String(value))}`);

  return `(${parts.join(";")})`;
};

/** A run of subrecords, as the value of one form parameter. */
export const encodeSubrecords = (records: readonly (readonly SubrecordField[])[]): string =>
  records.map(encodeSubrecord).join("");

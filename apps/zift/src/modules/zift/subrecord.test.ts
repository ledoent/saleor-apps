import { describe, expect, it } from "vitest";

import { encodeSubrecord, encodeSubrecords, sanitise } from "./subrecord";

describe("encodeSubrecords", () => {
  it("produces exactly the format Zift documents", () => {
    // Their own example, verbatim.
    expect(
      encodeSubrecords([
        [
          ["code", "001"],
          ["quantity", 1],
          ["description", "t-shirt"],
          ["totalAmount", 50000],
        ],
        [
          ["code", "002"],
          ["quantity", 1],
          ["description", "jeans"],
          ["totalAmount", 70000],
        ],
      ]),
    ).toBe("(code=001;quantity=1;description=t-shirt;totalAmount=50000)(code=002;quantity=1;description=jeans;totalAmount=70000)");
  });

  it("omits a field with no value rather than sending it empty", () => {
    // Zift validates field formats, and an empty string is a value that fails a
    // format check where an absent field simply is not there.
    expect(
      encodeSubrecord([
        ["code", "001"],
        ["description", null],
        ["quantity", 2],
      ]),
    ).toBe("(code=001;quantity=2)");
  });

  it("keeps a zero, which is a value and not an absence", () => {
    expect(encodeSubrecord([["totalAmount", 0]])).toBe("(totalAmount=0)");
  });
});

describe("sanitise", () => {
  it("neutralises every character that means something to the parser", () => {
    // "Workstation (rugged); 64 GB" is an ordinary catalogue string, and pasted
    // raw it produces two malformed items instead of one good one.
    expect(sanitise("Workstation (rugged); 64 GB")).toBe("Workstation rugged 64 GB");
    expect(sanitise("A=B")).toBe("A B");
  });

  it("replaces rather than deletes, so words do not run together", () => {
    expect(sanitise("Rack(2U)Chassis")).toBe("Rack 2U Chassis");
  });

  it("collapses whitespace, including newlines a description may carry", () => {
    expect(sanitise("Rugged\n  Workstation\t64GB ")).toBe("Rugged Workstation 64GB");
  });

  it("cannot produce a string that reopens the structure", () => {
    const nasty = "evil);(code=999;description=free";
    const encoded = encodeSubrecord([
      ["code", "001"],
      ["description", nasty],
    ]);

    // One record in, one record out. If this ever fails, a product name could
    // inject an extra line item into a Level 3 record.
    expect(encoded.match(/\(/g)).toHaveLength(1);
    expect(encoded.match(/\)/g)).toHaveLength(1);
    expect(encoded.split(";")).toHaveLength(2);
  });
});

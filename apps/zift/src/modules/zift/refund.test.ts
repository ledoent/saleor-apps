import { describe, expect, it, vi } from "vitest";

import { cancelCharge, refundCharge } from "./refund";

const approved = (type: string) => ({ responseType: type, responseCode: "A01", transactionId: "R1" });

describe("refundCharge", () => {
  it("refunds against the sale, in cents", async () => {
    const refund = vi.fn().mockResolvedValue(approved("refund"));
    const result = await refundCharge({ transactionId: "9001", amount: 500.25 }, { refund });

    expect(refund).toHaveBeenCalledWith({ transactionId: "9001", amount: 50025 });
    expect(result.result).toBe("REFUND_SUCCESS");
  });

  it("refuses when there is no original sale to reverse", async () => {
    // A refund that silently succeeded against nothing would show the customer
    // as repaid.
    const refund = vi.fn();
    const result = await refundCharge({ transactionId: "", amount: 500 }, { refund });

    expect(result.result).toBe("REFUND_FAILURE");
    expect(refund).not.toHaveBeenCalled();
  });

  it("fails a decline rather than reporting the money back", async () => {
    const result = await refundCharge(
      { transactionId: "9001", amount: 500 },
      { refund: vi.fn().mockResolvedValue({ responseType: "exception", responseMessage: "Too late" }) },
    );

    expect(result.result).toBe("REFUND_FAILURE");
    expect(result.message).toBe("Too late");
  });
});

describe("cancelCharge", () => {
  it("voids the unsettled sale", async () => {
    const voidTransaction = vi.fn().mockResolvedValue(approved("void"));
    const result = await cancelCharge("9001", { voidTransaction });

    expect(voidTransaction).toHaveBeenCalledWith({ transactionId: "9001" });
    expect(result.result).toBe("CANCEL_SUCCESS");
  });

  it("refuses without a reference rather than voiding nothing successfully", async () => {
    const voidTransaction = vi.fn();
    const result = await cancelCharge("", { voidTransaction });

    expect(result.result).toBe("CANCEL_FAILURE");
    expect(voidTransaction).not.toHaveBeenCalled();
  });
});

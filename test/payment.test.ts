import { describe, expect, it } from "vitest";
import { decodeFunctionData, pad, toHex, type PublicClient } from "viem";
import { ARC_MAINNET } from "../src/config.js";
import { ERC20_ABI } from "../src/abi.js";
import {
  buildUsdcTransferCalldata,
  decodePaymentRequest,
  encodePaymentRequest,
  isPaymentRequestExpired,
  verifyPayment,
} from "../src/payment.js";

const recipient = "0x1234567890123456789012345678901234567890" as const;
const payer = "0xAbCdEf0123456789aBcDeF0123456789aBCdEF01" as const;

describe("buildUsdcTransferCalldata", () => {
  it("encodes a plain ERC-20 transfer against Arc's USDC contract", () => {
    const { to, data } = buildUsdcTransferCalldata(recipient, "12.5");
    expect(to).toBe(ARC_MAINNET.usdc);
    const decoded = decodeFunctionData({ abi: ERC20_ABI, data });
    expect(decoded.functionName).toBe("transfer");
    expect(decoded.args[0]).toBe(recipient);
    expect(decoded.args[1]).toBe(12_500_000n);
  });

  it("rejects an invalid recipient", () => {
    expect(() => buildUsdcTransferCalldata("not-an-address" as any, "1")).toThrow(/Invalid recipient/);
  });

  it("rejects a non-positive amount", () => {
    expect(() => buildUsdcTransferCalldata(recipient, "0")).toThrow(/greater than zero/);
  });
});

describe("payment request encoding", () => {
  it("round-trips through encode/decode", () => {
    const uri = encodePaymentRequest({ recipient, amount: "9.99", reference: "invoice-7", expiresAt: 1_800_000_000 });
    expect(uri.startsWith("arc-usdc:pay?")).toBe(true);
    const decoded = decodePaymentRequest(uri);
    expect(decoded).toEqual({ recipient, amount: "9.99", reference: "invoice-7", expiresAt: 1_800_000_000 });
  });

  it("rejects decoding a non-payment URI", () => {
    expect(() => decodePaymentRequest("https://example.com")).toThrow(/Not an arc-usdc payment URI/);
  });

  it("rejects encoding an invalid recipient", () => {
    expect(() => encodePaymentRequest({ recipient: "bad" as any, amount: "1" })).toThrow(/Invalid recipient/);
  });

  it("flags an expired request", () => {
    const request = { recipient, amount: "1", expiresAt: 1000 };
    expect(isPaymentRequestExpired(request, 1001)).toBe(true);
    expect(isPaymentRequestExpired(request, 999)).toBe(false);
  });
});

function buildTransferLog(to: `0x${string}`, amount: bigint) {
  return {
    address: ARC_MAINNET.usdc,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as `0x${string}`,
      pad(payer, { size: 32 }),
      pad(to, { size: 32 }),
    ],
    data: toHex(amount, { size: 32 }),
  };
}

function fakeClient(overrides: { to?: `0x${string}`; amount?: bigint; status?: "success" | "reverted" }): PublicClient {
  const to = overrides.to ?? recipient;
  const amount = overrides.amount ?? 10_000_000n;
  const status = overrides.status ?? "success";
  return {
    getTransaction: async () => ({ from: payer, to: ARC_MAINNET.usdc }) as any,
    getTransactionReceipt: async () => ({
      status,
      blockNumber: 42n,
      logs: [buildTransferLog(to, amount)],
    }) as any,
  } as unknown as PublicClient;
}

describe("verifyPayment", () => {
  it("confirms a payment that matches the request", async () => {
    const client = fakeClient({ amount: 10_000_000n });
    const receipt = await verifyPayment(client, "0xhash" as `0x${string}`, { recipient, amount: "10" });
    expect(receipt.matchesRequest).toBe(true);
    expect(receipt.amount).toBe("10");
    expect(receipt.from).toBe(payer);
  });

  it("accepts an overpayment", async () => {
    const client = fakeClient({ amount: 20_000_000n });
    const receipt = await verifyPayment(client, "0xhash" as `0x${string}`, { recipient, amount: "10" });
    expect(receipt.matchesRequest).toBe(true);
  });

  it("rejects an underpayment", async () => {
    const client = fakeClient({ amount: 5_000_000n });
    const receipt = await verifyPayment(client, "0xhash" as `0x${string}`, { recipient, amount: "10" });
    expect(receipt.matchesRequest).toBe(false);
  });

  it("rejects a payment sent to the wrong recipient", async () => {
    const client = fakeClient({ to: payer, amount: 10_000_000n });
    const receipt = await verifyPayment(client, "0xhash" as `0x${string}`, { recipient, amount: "10" });
    expect(receipt.matchesRequest).toBe(false);
  });

  it("rejects a reverted transaction", async () => {
    const client = fakeClient({ status: "reverted" });
    await expect(verifyPayment(client, "0xhash" as `0x${string}`, { recipient, amount: "10" })).rejects.toThrow(
      /did not succeed/,
    );
  });

  it("rejects an expired request even if amounts match", async () => {
    const client = fakeClient({ amount: 10_000_000n });
    const receipt = await verifyPayment(client, "0xhash" as `0x${string}`, {
      recipient,
      amount: "10",
      expiresAt: 1,
    });
    expect(receipt.matchesRequest).toBe(false);
  });
});

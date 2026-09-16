import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData } from "viem";
import { SOURCE_CHAINS, ARC_MAINNET } from "../src/config.js";
import { TOKEN_MESSENGER_V2_ABI, ERC20_ABI, MESSAGE_TRANSMITTER_V2_ABI } from "../src/abi.js";
import {
  addressToBytes32,
  buildApproveCalldata,
  buildDepositForBurnCalldata,
  buildReceiveMessageCalldata,
  describeTransferPlan,
  fetchAttestation,
  waitForAttestation,
  FINALITY_THRESHOLD_FAST,
  FINALITY_THRESHOLD_STANDARD,
} from "../src/cctp.js";

const recipient = "0x1234567890123456789012345678901234567890" as const;

describe("addressToBytes32", () => {
  it("left-pads a 20-byte address into 32 bytes", () => {
    const padded = addressToBytes32(recipient);
    expect(padded).toHaveLength(66); // 0x + 64 hex chars
    expect(padded.toLowerCase().endsWith(recipient.slice(2).toLowerCase())).toBe(true);
  });
});

describe("buildApproveCalldata", () => {
  it("targets the source chain USDC contract and encodes the TokenMessengerV2 spender", () => {
    const { to, data } = buildApproveCalldata(SOURCE_CHAINS.ethereum, "100");
    expect(to).toBe(SOURCE_CHAINS.ethereum.usdc);
    const decoded = decodeFunctionData({ abi: ERC20_ABI, data });
    expect(decoded.functionName).toBe("approve");
    expect(decoded.args[0]).toBe(SOURCE_CHAINS.ethereum.tokenMessengerV2);
    expect(decoded.args[1]).toBe(100_000_000n);
  });
});

describe("buildDepositForBurnCalldata", () => {
  it("encodes a standard transfer targeting Arc's CCTP domain", () => {
    const { to, data, value } = buildDepositForBurnCalldata(SOURCE_CHAINS.base, {
      amount: "25",
      destinationRecipient: recipient,
    });
    expect(to).toBe(SOURCE_CHAINS.base.tokenMessengerV2);
    expect(value).toBe(0n);

    const decoded = decodeFunctionData({ abi: TOKEN_MESSENGER_V2_ABI, data });
    expect(decoded.functionName).toBe("depositForBurn");
    const [amount, destinationDomain, mintRecipient, burnToken, , maxFee, minFinalityThreshold] = decoded.args;
    expect(amount).toBe(25_000_000n);
    expect(destinationDomain).toBe(ARC_MAINNET.cctpDomain);
    expect(mintRecipient).toBe(addressToBytes32(recipient));
    expect(burnToken).toBe(SOURCE_CHAINS.base.usdc);
    expect(maxFee).toBe(0n);
    expect(minFinalityThreshold).toBe(FINALITY_THRESHOLD_STANDARD);
  });

  it("supports fast transfers with a nonzero max fee", () => {
    const { data } = buildDepositForBurnCalldata(SOURCE_CHAINS.arbitrum, {
      amount: "50",
      destinationRecipient: recipient,
      maxFee: "0.5",
      minFinalityThreshold: FINALITY_THRESHOLD_FAST,
    });
    const decoded = decodeFunctionData({ abi: TOKEN_MESSENGER_V2_ABI, data });
    const [, , , , , maxFee, minFinalityThreshold] = decoded.args;
    expect(maxFee).toBe(500_000n);
    expect(minFinalityThreshold).toBe(FINALITY_THRESHOLD_FAST);
  });

  it("rejects a zero or negative amount", () => {
    expect(() =>
      buildDepositForBurnCalldata(SOURCE_CHAINS.ethereum, { amount: "0", destinationRecipient: recipient }),
    ).toThrow(/greater than zero/);
  });

  it("rejects a maxFee that would consume the entire transfer", () => {
    expect(() =>
      buildDepositForBurnCalldata(SOURCE_CHAINS.ethereum, {
        amount: "10",
        destinationRecipient: recipient,
        maxFee: "10",
      }),
    ).toThrow(/maxFee must be less than/);
  });
});

describe("buildReceiveMessageCalldata", () => {
  it("targets Arc's MessageTransmitterV2 and forwards message + attestation", () => {
    const message = "0xabc123" as const;
    const attestation = "0xdef456" as const;
    const { to, data } = buildReceiveMessageCalldata(message, attestation);
    expect(to).toBe(ARC_MAINNET.messageTransmitterV2);
    const decoded = decodeFunctionData({ abi: MESSAGE_TRANSMITTER_V2_ABI, data });
    expect(decoded.args[0]).toBe(message);
    expect(decoded.args[1]).toBe(attestation);
  });
});

describe("fetchAttestation", () => {
  it("reports pending_confirmations while Iris has no message yet", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const result = await fetchAttestation(0, "0xhash", fetchImpl as any);
    expect(result.status).toBe("pending_confirmations");
    expect(result.attestation).toBeNull();
  });

  it("returns the attestation once Iris marks the message complete", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ messages: [{ message: "0x01", attestation: "0x02", status: "complete", eventNonce: "1" }] }),
          { status: 200 },
        ),
    );
    const result = await fetchAttestation(0, "0xhash", fetchImpl as any);
    expect(result.status).toBe("complete");
    expect(result.attestation).toBe("0x02");
  });

  it("throws on an unexpected HTTP error", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    await expect(fetchAttestation(0, "0xhash", fetchImpl as any)).rejects.toThrow(/status 500/);
  });
});

describe("waitForAttestation", () => {
  it("polls until the attestation completes", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls < 3) return new Response(null, { status: 404 });
      return new Response(
        JSON.stringify({ messages: [{ message: "0x01", attestation: "0x02", status: "complete" }] }),
        { status: 200 },
      );
    });
    const result = await waitForAttestation(0, "0xhash", { pollIntervalMs: 1, fetchImpl: fetchImpl as any });
    expect(result.status).toBe("complete");
    expect(calls).toBe(3);
  });

  it("times out if the attestation never completes", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      waitForAttestation(0, "0xhash", { pollIntervalMs: 1, timeoutMs: 5, fetchImpl: fetchImpl as any }),
    ).rejects.toThrow(/did not complete within/);
  });
});

describe("describeTransferPlan", () => {
  it("summarizes the source, destination, and fee mode", () => {
    const plan = describeTransferPlan(SOURCE_CHAINS.ethereum, {
      amount: "10",
      destinationRecipient: recipient,
    });
    expect(plan).toContain("Ethereum");
    expect(plan).toContain("Arc Mainnet");
    expect(plan).toContain("standard (hard finality)");
  });
});

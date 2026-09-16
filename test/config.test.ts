import { describe, expect, it } from "vitest";
import { ARC_MAINNET, SOURCE_CHAINS, getSourceChain } from "../src/config.js";

describe("config", () => {
  it("targets Arc Mainnet CCTP domain 26", () => {
    expect(ARC_MAINNET.cctpDomain).toBe(26);
    expect(ARC_MAINNET.chainId).toBe(5042);
  });

  it("exposes every supported source chain with a distinct CCTP domain", () => {
    const domains = Object.values(SOURCE_CHAINS).map((chain) => chain.cctpDomain);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it("throws for an unsupported source chain", () => {
    // @ts-expect-error intentionally invalid input for the runtime check
    expect(() => getSourceChain("solana")).toThrow(/Unsupported source chain/);
  });
});

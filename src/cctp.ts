import {
  encodeFunctionData,
  pad,
  parseUnits,
  formatUnits,
  type Address,
} from "viem";
import { ARC_MAINNET, IRIS_API_BASE_URL, USDC_DECIMALS, type ChainConfig } from "./config.js";
import { TOKEN_MESSENGER_V2_ABI, MESSAGE_TRANSMITTER_V2_ABI, ERC20_ABI } from "./abi.js";
import type { AttestationMessage, DepositForBurnParams, Hex } from "./types.js";

/** Standard (hard finality) transfers use 1000; Fast Transfers use 2000. */
export const FINALITY_THRESHOLD_STANDARD = 1000;
export const FINALITY_THRESHOLD_FAST = 2000;

/**
 * Left-pad a 20-byte EVM address into the bytes32 shape CCTP V2 expects
 * for `mintRecipient` and `destinationCaller`.
 */
export function addressToBytes32(address: Address): Hex {
  return pad(address, { size: 32 });
}

/**
 * Build the calldata for approving TokenMessengerV2 to pull `amount` USDC
 * from the caller. Call this before `buildDepositForBurnCalldata`.
 */
export function buildApproveCalldata(source: ChainConfig, amount: string): { to: Address; data: Hex } {
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [source.tokenMessengerV2, parseUnits(amount, USDC_DECIMALS)],
  });
  return { to: source.usdc, data };
}

/**
 * Build the calldata for TokenMessengerV2.depositForBurn(), which burns USDC
 * on the source chain and instructs Circle's attestation service to mint it
 * on Arc Mainnet (destination domain 26).
 *
 * This function only encodes calldata — it never sends a transaction or
 * touches a private key, so it is safe to unit test and to review before use.
 */
export function buildDepositForBurnCalldata(
  source: ChainConfig,
  params: DepositForBurnParams,
): { to: Address; data: Hex; value: bigint } {
  if (Number(params.amount) <= 0) {
    throw new Error("amount must be greater than zero");
  }
  const amount = parseUnits(params.amount, USDC_DECIMALS);
  const maxFee = parseUnits(params.maxFee ?? "0", USDC_DECIMALS);
  const minFinalityThreshold = params.minFinalityThreshold ?? FINALITY_THRESHOLD_STANDARD;

  if (maxFee >= amount) {
    throw new Error("maxFee must be less than the amount being transferred");
  }

  const data = encodeFunctionData({
    abi: TOKEN_MESSENGER_V2_ABI,
    functionName: "depositForBurn",
    args: [
      amount,
      ARC_MAINNET.cctpDomain,
      addressToBytes32(params.destinationRecipient),
      source.usdc,
      // 0x0 destinationCaller = anyone may relay receiveMessage() on Arc.
      addressToBytes32("0x0000000000000000000000000000000000000000"),
      maxFee,
      minFinalityThreshold,
    ],
  });

  return { to: source.tokenMessengerV2, data, value: 0n };
}

/** Build the calldata for MessageTransmitterV2.receiveMessage() on Arc. */
export function buildReceiveMessageCalldata(message: Hex, attestation: Hex): { to: Address; data: Hex } {
  const data = encodeFunctionData({
    abi: MESSAGE_TRANSMITTER_V2_ABI,
    functionName: "receiveMessage",
    args: [message, attestation],
  });
  return { to: ARC_MAINNET.messageTransmitterV2, data };
}

export interface IrisFetcher {
  (url: string): Promise<Response>;
}

/**
 * Poll Circle's Iris attestation service for the message emitted by a
 * depositForBurn transaction. Returns `status: "pending_confirmations"`
 * until the attestation is ready, then `"complete"` with a usable
 * attestation signature.
 *
 * Pass a custom `fetchImpl` in tests to avoid real network calls.
 */
export async function fetchAttestation(
  sourceDomain: number,
  transactionHash: Hex,
  fetchImpl: IrisFetcher = fetch,
): Promise<AttestationMessage> {
  const url = `${IRIS_API_BASE_URL}/messages/${sourceDomain}?transactionHash=${transactionHash}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    if (response.status === 404) {
      return { message: "0x", attestation: null, status: "pending_confirmations" };
    }
    throw new Error(`Iris attestation request failed with status ${response.status}`);
  }
  const body = (await response.json()) as {
    messages?: Array<{ message: Hex; attestation: Hex | null; status: string; eventNonce?: string }>;
  };
  const first = body.messages?.[0];
  if (!first) {
    return { message: "0x", attestation: null, status: "pending_confirmations" };
  }
  const status: AttestationMessage["status"] =
    first.status === "complete" ? "complete" : first.status === "failed" ? "failed" : "pending_confirmations";
  return {
    message: first.message,
    attestation: status === "complete" ? first.attestation : null,
    status,
    eventNonce: first.eventNonce,
  };
}

/**
 * Poll until the attestation is complete or the timeout elapses.
 * Iris typically finalizes Fast Transfers in seconds and standard
 * transfers in minutes; this defaults to a 10-minute ceiling.
 */
export async function waitForAttestation(
  sourceDomain: number,
  transactionHash: Hex,
  options: { pollIntervalMs?: number; timeoutMs?: number; fetchImpl?: IrisFetcher } = {},
): Promise<AttestationMessage> {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const result = await fetchAttestation(sourceDomain, transactionHash, options.fetchImpl);
    if (result.status === "complete" || result.status === "failed") {
      return result;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Attestation for ${transactionHash} did not complete within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/** Human-readable summary of a planned transfer, useful for CLI/UI display. */
export function describeTransferPlan(source: ChainConfig, params: DepositForBurnParams): string {
  const amount = params.amount;
  const fee = params.maxFee ?? "0";
  const speed = (params.minFinalityThreshold ?? FINALITY_THRESHOLD_STANDARD) === FINALITY_THRESHOLD_FAST
    ? "fast transfer"
    : "standard (hard finality)";
  return [
    `Burn ${amount} USDC on ${source.name} (domain ${source.cctpDomain})`,
    `Mint on Arc Mainnet (domain ${ARC_MAINNET.cctpDomain}) to ${params.destinationRecipient}`,
    `Mode: ${speed}, max fee: ${fee} USDC`,
  ].join("\n");
}

export function formatUsdc(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}

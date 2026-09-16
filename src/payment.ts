import { encodeFunctionData, isAddress, parseUnits, formatUnits, type Address, type PublicClient } from "viem";
import { ARC_MAINNET, USDC_DECIMALS } from "./config.js";
import { ERC20_ABI } from "./abi.js";
import type { Hex, PaymentReceipt, PaymentRequest } from "./types.js";

/**
 * Build the calldata for a direct native-USDC transfer on Arc Mainnet.
 * USDC is Arc's gas token, so this is a plain ERC-20 transfer — no
 * approval or intermediary contract needed for a simple payment.
 */
export function buildUsdcTransferCalldata(recipient: Address, amount: string): { to: Address; data: Hex } {
  if (!isAddress(recipient)) {
    throw new Error(`Invalid recipient address: ${recipient}`);
  }
  if (Number(amount) <= 0) {
    throw new Error("amount must be greater than zero");
  }
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [recipient, parseUnits(amount, USDC_DECIMALS)],
  });
  return { to: ARC_MAINNET.usdc, data };
}

/**
 * Encode a payment request as a URI, following the ERC-681-style
 * `pay-` scheme used by wallets and QR codes:
 *   arc-usdc:pay?to=0x...&amount=12.34&ref=invoice-42&expires=1780000000
 *
 * This is a plain string format — no on-chain state is created until the
 * payer actually submits the transfer built by `buildUsdcTransferCalldata`.
 */
export function encodePaymentRequest(request: PaymentRequest): string {
  if (!isAddress(request.recipient)) {
    throw new Error(`Invalid recipient address: ${request.recipient}`);
  }
  const params = new URLSearchParams({ to: request.recipient, amount: request.amount });
  if (request.reference) params.set("ref", request.reference);
  if (request.expiresAt) params.set("expires", String(request.expiresAt));
  return `arc-usdc:pay?${params.toString()}`;
}

export function decodePaymentRequest(uri: string): PaymentRequest {
  const match = uri.match(/^arc-usdc:pay\?(.+)$/);
  if (!match) {
    throw new Error(`Not an arc-usdc payment URI: ${uri}`);
  }
  const params = new URLSearchParams(match[1]);
  const to = params.get("to");
  const amount = params.get("amount");
  if (!to || !isAddress(to)) {
    throw new Error(`Payment URI is missing a valid recipient: ${uri}`);
  }
  if (!amount || Number(amount) <= 0) {
    throw new Error(`Payment URI is missing a valid amount: ${uri}`);
  }
  const request: PaymentRequest = { recipient: to, amount };
  const ref = params.get("ref");
  if (ref) request.reference = ref;
  const expires = params.get("expires");
  if (expires) request.expiresAt = Number(expires);
  return request;
}

export function isPaymentRequestExpired(request: PaymentRequest, nowSeconds: number = Math.floor(Date.now() / 1000)): boolean {
  return typeof request.expiresAt === "number" && nowSeconds > request.expiresAt;
}

/**
 * Verify that a submitted transaction actually satisfies a payment request:
 * correct recipient, correct token, sufficient amount, and mined on-chain.
 *
 * This distrusts the caller-supplied `txHash` string and instead reads the
 * transaction and its receipt from the RPC, which is the only reliable
 * source of settlement truth. Never treat "the wallet said it submitted"
 * as proof of payment — always verify against the chain.
 */
export async function verifyPayment(
  client: PublicClient,
  txHash: Hex,
  request: PaymentRequest,
): Promise<PaymentReceipt> {
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: txHash }),
    client.getTransactionReceipt({ hash: txHash }),
  ]);

  if (receipt.status !== "success") {
    throw new Error(`Transaction ${txHash} did not succeed (status: ${receipt.status})`);
  }
  if (tx.to?.toLowerCase() !== ARC_MAINNET.usdc.toLowerCase()) {
    throw new Error(`Transaction ${txHash} did not call the USDC contract`);
  }

  const transferLog = receipt.logs.find((log) => log.address.toLowerCase() === ARC_MAINNET.usdc.toLowerCase());
  if (!transferLog || transferLog.topics.length < 3 || !transferLog.data) {
    throw new Error(`Transaction ${txHash} has no USDC Transfer log`);
  }

  const toTopic = transferLog.topics[2];
  if (!toTopic) {
    throw new Error(`Transaction ${txHash} Transfer log is missing the recipient topic`);
  }
  const loggedTo = `0x${toTopic.slice(-40)}` as Address;
  const loggedAmount = formatUnits(BigInt(transferLog.data), USDC_DECIMALS);

  const matchesRequest =
    loggedTo.toLowerCase() === request.recipient.toLowerCase() &&
    Number(loggedAmount) >= Number(request.amount) &&
    !isPaymentRequestExpired(request);

  return {
    txHash,
    from: tx.from,
    to: loggedTo,
    amount: loggedAmount,
    blockNumber: receipt.blockNumber,
    matchesRequest,
  };
}

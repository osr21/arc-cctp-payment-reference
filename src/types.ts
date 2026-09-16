export type Hex = `0x${string}`;

/** Circle attestation status returned by the Iris API. */
export type AttestationStatus = "pending_confirmations" | "complete" | "failed";

export interface AttestationMessage {
  /** ABI-encoded CCTP message bytes. */
  message: Hex;
  /** Circle's signature over the message, required by receiveMessage(). */
  attestation: Hex | null;
  status: AttestationStatus;
  eventNonce?: string;
}

export interface DepositForBurnParams {
  /** Amount of USDC to bridge, in whole USDC (e.g. "25.50"). */
  amount: string;
  /** Destination address on Arc that should receive the minted USDC. */
  destinationRecipient: Hex;
  /**
   * Max fee the sender is willing to pay for a Fast Transfer, in whole USDC.
   * Set to "0" to force the slower, cheaper standard/finalized path.
   */
  maxFee?: string;
  /**
   * Finality threshold: 1000 = standard (hard finality), 2000 = fast transfer.
   * See https://developers.circle.com/cctp/technical-guide for details.
   */
  minFinalityThreshold?: number;
}

export interface PaymentRequest {
  /** Recipient address that should receive the payment. */
  recipient: Hex;
  /** Amount in whole USDC (e.g. "12.34"). */
  amount: string;
  /** Free-form reference/memo, e.g. an invoice id. Kept off-chain by default. */
  reference?: string;
  /** Unix seconds after which the request should no longer be honored. */
  expiresAt?: number;
}

export interface PaymentReceipt {
  txHash: Hex;
  from: Hex;
  to: Hex;
  amount: string;
  blockNumber: bigint;
  matchesRequest: boolean;
}

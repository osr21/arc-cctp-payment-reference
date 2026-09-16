/**
 * Chain and contract configuration for CCTP V2 transfers into Arc Mainnet,
 * plus the native-USDC payment rail on Arc itself.
 *
 * Source-chain USDC and CCTP addresses below are the canonical values
 * published by Circle: https://developers.circle.com/cctp/references/contract-addresses
 * Arc-side addresses are the values used in production by the Arc Mainnet
 * Hub (see https://github.com/circlefin/arc-node for the network itself).
 *
 * ALWAYS re-verify addresses against the official registry before moving
 * real funds — this file is a reference, not a source of truth that
 * overrides Circle's live registry.
 */

export type SupportedSourceChain = "ethereum" | "base" | "arbitrum";

export interface ChainConfig {
  /** Human readable name. */
  name: string;
  /** EVM chain id. */
  chainId: number;
  /** CCTP domain id (Circle's own chain identifier, distinct from chainId). */
  cctpDomain: number;
  /** Default public RPC endpoint. Override for production traffic. */
  rpcUrl: string;
  /** Native USDC ERC-20 address on this chain. */
  usdc: `0x${string}`;
  /** TokenMessengerV2 address (burns USDC, emits the CCTP message). */
  tokenMessengerV2: `0x${string}`;
  /** MessageTransmitterV2 address (verifies attestations, mints on destination). */
  messageTransmitterV2: `0x${string}`;
  /** Block explorer transaction URL prefix. */
  explorerTx: string;
}

// TokenMessengerV2 / MessageTransmitterV2 share the same CREATE2 address across
// every standard CCTP V2 EVM deployment (Ethereum, Base, Arbitrum, Arc, ...).
const TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as const;
const MESSAGE_TRANSMITTER_V2 = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as const;

export const ARC_MAINNET: ChainConfig = {
  name: "Arc Mainnet",
  chainId: 5042,
  cctpDomain: 26,
  rpcUrl: "https://rpc.mainnet.arc.io",
  usdc: "0x3600000000000000000000000000000000000000",
  tokenMessengerV2: TOKEN_MESSENGER_V2,
  messageTransmitterV2: MESSAGE_TRANSMITTER_V2,
  explorerTx: "https://explorer.arc.io/tx",
};

export const SOURCE_CHAINS: Record<SupportedSourceChain, ChainConfig> = {
  ethereum: {
    name: "Ethereum",
    chainId: 1,
    cctpDomain: 0,
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    tokenMessengerV2: TOKEN_MESSENGER_V2,
    messageTransmitterV2: MESSAGE_TRANSMITTER_V2,
    explorerTx: "https://etherscan.io/tx",
  },
  base: {
    name: "Base",
    chainId: 8453,
    cctpDomain: 6,
    rpcUrl: "https://mainnet.base.org",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenMessengerV2: TOKEN_MESSENGER_V2,
    messageTransmitterV2: MESSAGE_TRANSMITTER_V2,
    explorerTx: "https://basescan.org/tx",
  },
  arbitrum: {
    name: "Arbitrum One",
    chainId: 42161,
    cctpDomain: 3,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    tokenMessengerV2: TOKEN_MESSENGER_V2,
    messageTransmitterV2: MESSAGE_TRANSMITTER_V2,
    explorerTx: "https://arbiscan.io/tx",
  },
};

/** Circle's off-chain attestation service (Iris), mainnet base URL. */
export const IRIS_API_BASE_URL = "https://iris-api.circle.com/v2";

/** USDC always uses 6 decimals on every CCTP-supported chain. */
export const USDC_DECIMALS = 6;

export function getSourceChain(chain: SupportedSourceChain): ChainConfig {
  const config = SOURCE_CHAINS[chain];
  if (!config) {
    throw new Error(`Unsupported source chain: ${chain}`);
  }
  return config;
}

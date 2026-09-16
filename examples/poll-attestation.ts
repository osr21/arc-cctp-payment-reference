/**
 * Poll Circle's Iris attestation service for an existing depositForBurn
 * transaction, without sending anything. Useful for resuming a bridge
 * flow after the burn transaction already landed.
 *
 * Usage:
 *   tsx examples/poll-attestation.ts base 0xBurnTxHash...
 */
import { getSourceChain, waitForAttestation, type SupportedSourceChain } from "../src/index.js";

async function main() {
  const [chainName, txHash] = process.argv.slice(2);
  if (!chainName || !txHash) {
    throw new Error("Usage: tsx examples/poll-attestation.ts <ethereum|base|arbitrum> <burnTxHash>");
  }
  const source = getSourceChain(chainName as SupportedSourceChain);
  console.log(`Polling Iris for domain ${source.cctpDomain} (${source.name}), tx ${txHash}...`);
  const result = await waitForAttestation(source.cctpDomain, txHash as `0x${string}`);
  console.log(result);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

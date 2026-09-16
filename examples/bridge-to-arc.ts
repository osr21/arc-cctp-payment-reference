/**
 * Bridge USDC from Ethereum, Base, or Arbitrum into Arc Mainnet via CCTP V2.
 *
 * Usage:
 *   PRIVATE_KEY=0x... tsx examples/bridge-to-arc.ts base 25 0xArcRecipient...
 */
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildApproveCalldata,
  buildDepositForBurnCalldata,
  buildReceiveMessageCalldata,
  describeTransferPlan,
  getSourceChain,
  waitForAttestation,
  type SupportedSourceChain,
} from "../src/index.js";
import { ARC_MAINNET } from "../src/config.js";

async function main() {
  const [chainName, amount, recipient] = process.argv.slice(2);
  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  if (!chainName || !amount || !recipient) {
    throw new Error("Usage: tsx examples/bridge-to-arc.ts <ethereum|base|arbitrum> <amount> <arcRecipient>");
  }
  if (!privateKey) {
    throw new Error("Set PRIVATE_KEY in your environment (see .env.example). Never hardcode it.");
  }

  const source = getSourceChain(chainName as SupportedSourceChain);
  const account = privateKeyToAccount(privateKey);
  const chain = { id: source.chainId, name: source.name, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [source.rpcUrl] } } };
  const publicClient = createPublicClient({ chain: chain as any, transport: http(source.rpcUrl) });
  const walletClient = createWalletClient({ account, chain: chain as any, transport: http(source.rpcUrl) });

  const params = { amount, destinationRecipient: recipient as `0x${string}` };
  console.log(describeTransferPlan(source, params));

  const approve = buildApproveCalldata(source, amount);
  const approveHash = await walletClient.sendTransaction(approve);
  console.log(`Approved TokenMessengerV2: ${source.explorerTx}/${approveHash}`);
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const burn = buildDepositForBurnCalldata(source, params);
  const burnHash = await walletClient.sendTransaction(burn);
  console.log(`Burned on ${source.name}: ${source.explorerTx}/${burnHash}`);
  await publicClient.waitForTransactionReceipt({ hash: burnHash });

  console.log("Waiting for Circle's attestation (Iris)...");
  const attestation = await waitForAttestation(source.cctpDomain, burnHash);
  if (attestation.status !== "complete" || !attestation.attestation) {
    throw new Error(`Attestation did not complete: ${attestation.status}`);
  }

  const arcPublicClient = createPublicClient({
    chain: { id: ARC_MAINNET.chainId, name: ARC_MAINNET.name, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 }, rpcUrls: { default: { http: [ARC_MAINNET.rpcUrl] } } } as any,
    transport: http(ARC_MAINNET.rpcUrl),
  });
  const arcWalletClient = createWalletClient({
    account,
    chain: { id: ARC_MAINNET.chainId, name: ARC_MAINNET.name, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 }, rpcUrls: { default: { http: [ARC_MAINNET.rpcUrl] } } } as any,
    transport: http(ARC_MAINNET.rpcUrl),
  });

  const receiveMessage = buildReceiveMessageCalldata(attestation.message, attestation.attestation);
  const mintHash = await arcWalletClient.sendTransaction(receiveMessage);
  console.log(`Minted on Arc Mainnet: ${ARC_MAINNET.explorerTx}/${mintHash}`);
  await arcPublicClient.waitForTransactionReceipt({ hash: mintHash });
  console.log("Bridge complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

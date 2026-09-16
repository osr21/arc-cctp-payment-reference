/**
 * Send a native USDC payment on Arc Mainnet.
 *
 * Usage:
 *   PRIVATE_KEY=0x... tsx examples/send-arc-usdc.ts <recipient> <amount>
 */
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET, buildUsdcTransferCalldata, verifyPayment } from "../src/index.js";

async function main() {
  const [recipient, amount] = process.argv.slice(2);
  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  if (!recipient || !amount) {
    throw new Error("Usage: tsx examples/send-arc-usdc.ts <recipient> <amount>");
  }
  if (!privateKey) {
    throw new Error("Set PRIVATE_KEY in your environment (see .env.example). Never hardcode it.");
  }

  const account = privateKeyToAccount(privateKey);
  const chain = { id: ARC_MAINNET.chainId, name: ARC_MAINNET.name, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 }, rpcUrls: { default: { http: [ARC_MAINNET.rpcUrl] } } };
  const publicClient = createPublicClient({ chain: chain as any, transport: http(ARC_MAINNET.rpcUrl) });
  const walletClient = createWalletClient({ account, chain: chain as any, transport: http(ARC_MAINNET.rpcUrl) });

  const { to, data } = buildUsdcTransferCalldata(recipient as `0x${string}`, amount);
  console.log(`Sending ${amount} USDC from ${account.address} to ${recipient} on ${ARC_MAINNET.name}...`);
  const hash = await walletClient.sendTransaction({ to, data });
  console.log(`Submitted: ${ARC_MAINNET.explorerTx}/${hash}`);

  await publicClient.waitForTransactionReceipt({ hash });
  const receipt = await verifyPayment(publicClient as any, hash, { recipient: recipient as `0x${string}`, amount });
  console.log("Verified on-chain:", receipt);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

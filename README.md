# Arc CCTP + Payment Reference Stack

An open-source, dependency-light reference implementation for two things builders
repeatedly need on [Arc](https://arc.io) — Circle's public, USDC-native Layer 1:

1. **Native USDC payments on Arc Mainnet.** Arc uses USDC as its gas token, so a
   payment is a plain ERC-20 transfer. This stack adds request encoding
   (`arc-usdc:pay?...` URIs for QR codes / links) and on-chain payment
   verification so a merchant never has to trust a client-reported "it worked."
2. **CCTP V2 transfers into Arc.** Calldata builders for `depositForBurn` on the
   source chain and `receiveMessage` on Arc, plus a client for Circle's Iris
   attestation service — the same lifecycle used by the
   [Arc Mainnet Hub](https://github.com/circlefin/arc-node).

This is calldata-building and verification logic, not a wallet or a custodial
service. It never holds a private key on your behalf; every example script
reads `PRIVATE_KEY` from the environment and signs locally.

## Why this exists

Most CCTP examples are either a single hardcoded script or buried inside a
larger dapp. This package isolates the reusable parts — config, calldata
encoding, attestation polling, payment verification — behind a small,
fully-tested API so you can import just what you need into your own backend,
CLI, or frontend.

## Install

```bash
npm install arc-cctp-payment-reference
```

Or clone this repo directly and use it as a starting point:

```bash
git clone https://github.com/osr21/arc-cctp-payment-reference
cd arc-cctp-payment-reference
npm install
npm test
```

## Quick start: accept a native USDC payment on Arc

```ts
import { encodePaymentRequest, buildUsdcTransferCalldata, verifyPayment } from "arc-cctp-payment-reference";
import { createPublicClient, http } from "viem";
import { ARC_MAINNET } from "arc-cctp-payment-reference";

// 1. Create a payment request (share this as a link or QR code)
const uri = encodePaymentRequest({
  recipient: "0xYourMerchantAddress",
  amount: "25.00",
  reference: "invoice-1042",
});

// 2. The payer's wallet builds the transfer from the request
const { to, data } = buildUsdcTransferCalldata("0xYourMerchantAddress", "25.00");
// ...wallet_sendTransaction({ to, data }) happens client-side...

// 3. You verify the resulting transaction against the chain, not the client
const publicClient = createPublicClient({ transport: http(ARC_MAINNET.rpcUrl) });
const receipt = await verifyPayment(publicClient, txHash, { recipient: "0xYourMerchantAddress", amount: "25.00" });
if (receipt.matchesRequest) {
  // fulfil the order
}
```

## Quick start: bridge USDC into Arc via CCTP V2

```ts
import { getSourceChain, buildApproveCalldata, buildDepositForBurnCalldata, waitForAttestation, buildReceiveMessageCalldata } from "arc-cctp-payment-reference";

const source = getSourceChain("base");

// 1. Approve TokenMessengerV2 to pull USDC
const approve = buildApproveCalldata(source, "50");
// ...sign & send `approve` on the source chain...

// 2. Burn USDC on the source chain, targeting Arc (CCTP domain 26)
const burn = buildDepositForBurnCalldata(source, {
  amount: "50",
  destinationRecipient: "0xYourArcAddress",
});
// ...sign & send `burn`, keep the resulting txHash...

// 3. Wait for Circle's Iris service to attest the burn
const attestation = await waitForAttestation(source.cctpDomain, burnTxHash);

// 4. Submit the mint on Arc
const mint = buildReceiveMessageCalldata(attestation.message, attestation.attestation!);
// ...sign & send `mint` on Arc Mainnet...
```

Runnable, end-to-end versions of both flows live in `examples/`:

```bash
PRIVATE_KEY=0x... npm run example:send   -- 0xRecipient 10
PRIVATE_KEY=0x... npm run example:bridge -- base 25 0xArcRecipient
npm run example:poll -- base 0xBurnTxHash
```

## API surface

| Module | Purpose |
| --- | --- |
| `config.ts` | Chain configs (Arc Mainnet + Ethereum/Base/Arbitrum), CCTP domains, contract addresses |
| `cctp.ts` | `depositForBurn` / `receiveMessage` calldata builders, Iris attestation polling |
| `payment.ts` | USDC transfer calldata, payment-request encode/decode, on-chain payment verification |
| `abi.ts` | Minimal ABIs for ERC-20, TokenMessengerV2, MessageTransmitterV2 |

All functions that build a transaction return `{ to, data }` (or `{ to, data, value }`)
and never send it — you control signing and submission with your own client
(`viem`, `ethers`, a wallet SDK, etc).

## Design decisions worth knowing about

- **Standard vs. Fast Transfer.** `minFinalityThreshold: 1000` (default) waits
  for hard finality; `2000` requests Circle's Fast Transfer for a fee. Fast
  Transfers still require you to set `maxFee` above zero or Circle will not
  fulfil them.
- **`destinationCaller` defaults to `0x0`**, meaning anyone can relay
  `receiveMessage` on Arc once the attestation is ready. Restrict it if you
  need the mint to only be submittable by a specific relayer.
- **Payment verification reads the chain, not the caller.** `verifyPayment`
  fetches the transaction and receipt directly from an RPC node and checks the
  USDC `Transfer` log — a client claiming success is never sufficient proof of
  payment.
- **Addresses are the standard CCTP V2 CREATE2 deployment** (same
  `TokenMessengerV2` / `MessageTransmitterV2` address across supported EVM
  chains). Always cross-check against Circle's
  [contract address registry](https://developers.circle.com/cctp/references/contract-addresses)
  before moving real funds — this file is a reference, not a substitute for
  the live registry.

## Testing

```bash
npm test
```

All 20+ tests run against mocked `fetch`/RPC clients — no network access or
funded wallet required to validate the encoding and verification logic.

## Contributing

Issues and PRs are welcome. If you add support for another CCTP-connected
source chain, please also add config test coverage confirming its CCTP domain
is unique.

## License

MIT — see [LICENSE](./LICENSE).

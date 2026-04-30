/**
 * Direct facilitator probe: builds a payment payload locally and posts it to
 * x402.org/facilitator/verify to get the full invalidMessage from the
 * facilitator (instead of just the truncated error in the 402 response).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { ExactSvmScheme } from "@x402/svm/exact/client";

const NETWORK: `${string}:${string}` =
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const RPC_URL = "https://api.devnet.solana.com";
const FACILITATOR = "https://x402.org/facilitator";
const SENDER_PATH = resolve(
  process.cwd(),
  "../../packages/sdk/wallets/sender.json"
);

const paymentRequirements = {
  scheme: "exact",
  network: NETWORK,
  amount: "1000",
  asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  payTo: "3EzHvMnL7cnW6yrm6DoWYYdocKcYZcVj9mbA1fGFP7wX",
  maxTimeoutSeconds: 300,
  extra: { feePayer: "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5" },
};

async function main() {
  const bytes = JSON.parse(readFileSync(SENDER_PATH, "utf-8")) as number[];
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(bytes));
  console.log("signer:", signer.address);

  const scheme = new ExactSvmScheme(signer, { rpcUrl: RPC_URL });
  const payload = await scheme.createPaymentPayload(2, paymentRequirements);
  console.log("payment payload built, x402Version:", payload.x402Version);

  const fullPayload = {
    x402Version: payload.x402Version,
    accepted: paymentRequirements,
    payload: payload.payload,
  };

  const verifyRes = await fetch(`${FACILITATOR}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: fullPayload,
      paymentRequirements,
    }),
  });
  console.log("verify status:", verifyRes.status);
  console.log("verify body:", JSON.stringify(await verifyRes.json(), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

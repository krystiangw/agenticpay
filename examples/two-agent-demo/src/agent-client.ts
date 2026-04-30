/**
 * Two-agent demo client.
 *
 * Loads the sender keypair (the one funded with USDC during the SDK smoke
 * test), builds an x402 client with the SVM exact scheme, and calls the
 * paywalled tools on the agenticpay server. The first call gets a 402; the
 * fetch wrapper signs a USDC payment, retries, and returns the tool result.
 *
 * Prereqs:
 *  - The mcp-server is running locally on http://localhost:4021
 *    (`pnpm --filter @agenticpay/mcp-server dev` with PAY_TO=<recipient pubkey>)
 *  - packages/sdk/wallets/sender.json exists and is funded with USDC
 *
 * Run: `pnpm --filter @agenticpay/two-agent-demo client`
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:4021";
// Devnet (CAIP-2 v2). Lib const SOLANA_DEVNET_CAIP2.
const NETWORK: `${string}:${string}` =
  (process.env.NETWORK as `${string}:${string}` | undefined) ??
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const RPC_URL =
  process.env.SOLANA_DEVNET_RPC ?? "https://api.devnet.solana.com";
const SENDER_PATH =
  process.env.SENDER_KEYPAIR ??
  resolve(process.cwd(), "../../packages/sdk/wallets/sender.json");

async function main() {
  const bytes = JSON.parse(readFileSync(SENDER_PATH, "utf-8")) as number[];
  if (bytes.length !== 64) {
    throw new Error(
      `Expected 64-byte keypair, got ${bytes.length}. Path: ${SENDER_PATH}`
    );
  }
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(bytes));
  console.log(`Agent A signer: ${signer.address} (network: ${NETWORK})`);

  const client = new x402Client();
  client.register(
    NETWORK as `${string}:${string}`,
    new ExactSvmScheme(signer, { rpcUrl: RPC_URL })
  );

  const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, client);

  console.log();
  console.log("[1/2] GET / (free, lists tools and prices)");
  const indexRes = await fetch(SERVER_URL + "/");
  const index = await indexRes.json();
  console.log(JSON.stringify(index, null, 2));

  console.log();
  console.log("[2/2] POST /tools/reverse  (paid: $0.001)");
  const t0 = Date.now();
  const res = await fetchWithPayment(SERVER_URL + "/tools/reverse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "agenticpay works" }),
  });
  const elapsedMs = Date.now() - t0;

  if (!res.ok) {
    console.error(`request failed: ${res.status} ${res.statusText}`);
    console.error("response headers:");
    res.headers.forEach((v, k) => console.error(`  ${k}: ${v}`));
    console.error("body:", await res.text());
    process.exit(1);
  }

  const body = await res.json();
  console.log("server response:", body);
  console.log(`elapsed: ${elapsedMs}ms (includes 402, sign, retry, settle)`);

  const paymentResponse = res.headers.get("x-payment-response");
  if (paymentResponse) {
    console.log("x-payment-response present (settlement details)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

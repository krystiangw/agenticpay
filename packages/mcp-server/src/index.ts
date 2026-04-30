/**
 * agentpay payment server.
 *
 * HTTP server exposing AI-agent tools behind an x402 USDC paywall on Solana.
 * Each tool is a regular Express route protected by `paymentMiddleware`. When
 * an unpaid request arrives, x402 returns HTTP 402 with payment requirements.
 * The client signs a USDC transfer payload, retries with the X-PAYMENT header,
 * and the facilitator settles on-chain before the route runs.
 *
 * Run: `pnpm --filter @agentpay/mcp-server dev`
 */
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import type { Network } from "@x402/core/types";

const PORT = Number(process.env.PORT ?? 4021);
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";
// CAIP-2 v2 identifiers from @x402/svm constants:
//   devnet:  solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
//   mainnet: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
// Note: x402.org/facilitator currently lists ONLY the devnet identifier under
// v2 — it does not host mainnet on this protocol version yet.
const NETWORK = (process.env.NETWORK ?? "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1") as Network;
const PAY_TO = process.env.PAY_TO;

if (!PAY_TO) {
  console.error("PAY_TO env var is required (Solana address that receives payments)");
  console.error("Tip: export PAY_TO=$(node packages/cli/dist/index.js wallet show --wallet packages/sdk/wallets/recipient.json | tail -1 | awk '{print $3}')");
  process.exit(1);
}

// Devnet USDC mint (Circle faucet). Use the AssetAmount form for `price` so
// the scheme uses this exact mint and bypasses any default money parser.
const USDC_DEVNET_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const usdcDevnet = (humanAmount: number) => ({
  asset: USDC_DEVNET_MINT,
  amount: Math.round(humanAmount * 1_000_000).toString(),
});

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator)
  .register(NETWORK, new ExactSvmScheme())
  .onVerifyFailure(async (ctx: unknown) => {
    console.error("[verify failure]", JSON.stringify(ctx, null, 2));
  })
  .onSettleFailure(async (ctx: unknown) => {
    console.error("[settle failure]", JSON.stringify(ctx, null, 2));
  });

const routes = {
  "POST /tools/reverse": {
    accepts: [
      {
        scheme: "exact" as const,
        price: usdcDevnet(0.001),
        network: NETWORK,
        payTo: PAY_TO,
      },
    ],
    description: "Reverse a string. Body: { text: string }",
    mimeType: "application/json",
  },
  "POST /tools/word-count": {
    accepts: [
      {
        scheme: "exact" as const,
        price: usdcDevnet(0.0005),
        network: NETWORK,
        payTo: PAY_TO,
      },
    ],
    description: "Count words in a string. Body: { text: string }",
    mimeType: "application/json",
  },
};

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    service: "agentpay",
    version: "0.0.1",
    network: NETWORK,
    facilitator: FACILITATOR_URL,
    payTo: PAY_TO,
    tools: Object.entries(routes).map(([key, cfg]) => ({
      route: key,
      price: cfg.accepts[0]?.price,
      description: cfg.description,
    })) as unknown,
  });
});

app.use(paymentMiddleware(routes, resourceServer));

app.post("/tools/reverse", (req, res) => {
  const text = String((req.body as { text?: unknown })?.text ?? "");
  res.json({ result: text.split("").reverse().join("") });
});

app.post("/tools/word-count", (req, res) => {
  const text = String((req.body as { text?: unknown })?.text ?? "");
  const count = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
  res.json({ count });
});

app.listen(PORT, () => {
  console.log(`agentpay server listening on http://localhost:${PORT}`);
  console.log(`network:     ${NETWORK}`);
  console.log(`facilitator: ${FACILITATOR_URL}`);
  console.log(`payTo:       ${PAY_TO}`);
  for (const [key, cfg] of Object.entries(routes)) {
    const p = cfg.accepts[0]?.price;
    console.log(`  ${key}  ->  ${p?.amount} base units of ${p?.asset}`);
  }
});

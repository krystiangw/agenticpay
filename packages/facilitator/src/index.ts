/**
 * agentpay self-hosted x402 facilitator.
 *
 * Express server exposing the standard x402 facilitator endpoints:
 *   GET  /supported  → list of (scheme, network) pairs we can verify and settle
 *   POST /verify     → verify a signed payment payload (no on-chain submit)
 *   POST /settle     → submit the signed payload on-chain and confirm
 *
 * Backed by @x402/core/facilitator + @x402/svm/exact/facilitator. Our own
 * keypair (./wallets/facilitator.json by default) is the fee_payer for every
 * tx, so payers don't need any SOL — they only need USDC.
 *
 * Run: `pnpm --filter @agenticpay/facilitator dev`
 */
import express from "express";
import { resolve } from "node:path";
import {
  createSolanaRpc,
  devnet as devnetRpc,
  mainnet as mainnetRpc,
} from "@solana/kit";
import { x402Facilitator } from "@x402/core/facilitator";
import type { Network } from "@x402/core/types";
import { ExactSvmScheme } from "@x402/svm/exact/facilitator";
import { toFacilitatorSvmSigner } from "@x402/svm";
import { loadOrCreateFacilitatorSigner } from "./keypair.js";
import { analytics } from "./analytics.js";

// Heroku/Fly.io assign the listen port via PORT; FACILITATOR_PORT is the
// local-development override that takes precedence when set.
const PORT = Number(process.env.FACILITATOR_PORT ?? process.env.PORT ?? 4022);
const KEYPAIR_PATH = resolve(
  process.env.FACILITATOR_KEYPAIR ?? "./wallets/facilitator.json"
);
const DEVNET_RPC =
  process.env.SOLANA_DEVNET_RPC ?? "https://api.devnet.solana.com";
const MAINNET_RPC =
  process.env.SOLANA_MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";

const SOLANA_DEVNET_CAIP2: Network =
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const SOLANA_MAINNET_CAIP2: Network =
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

async function main() {
  analytics.init(process.env.POSTHOG_API_KEY, process.env.POSTHOG_HOST);

  const signer = await loadOrCreateFacilitatorSigner(KEYPAIR_PATH);
  console.log(`Facilitator signer: ${signer.address}`);
  console.log(`Keypair persisted:  ${KEYPAIR_PATH}`);

  analytics.capture("facilitator_started", undefined, {
    feePayer: signer.address,
    networks: [SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2],
  });

  // RPC client per network so the facilitator can simulate/submit on each.
  const rpcByNetwork: Record<string, ReturnType<typeof createSolanaRpc>> = {
    [SOLANA_DEVNET_CAIP2]: createSolanaRpc(devnetRpc(DEVNET_RPC)),
    [SOLANA_MAINNET_CAIP2]: createSolanaRpc(mainnetRpc(MAINNET_RPC)),
  };

  const facilitatorSigner = toFacilitatorSvmSigner(signer, rpcByNetwork);
  const scheme = new ExactSvmScheme(facilitatorSigner);

  const facilitator = new x402Facilitator()
    .register([SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2], scheme)
    .onAfterVerify(async (ctx) => {
      console.log(`[verify ok]   payer=${ctx.result.payer}`);
    })
    .onVerifyFailure(async (ctx) => {
      console.warn(`[verify FAIL] ${ctx.error.message}`);
    })
    .onAfterSettle(async (ctx) => {
      console.log(
        `[settle ok]   tx=${ctx.result.transaction}  payer=${ctx.result.payer}`
      );
    })
    .onSettleFailure(async (ctx) => {
      console.warn(`[settle FAIL] ${ctx.error.message}`);
    });

  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/supported", (_req, res) => {
    res.json(facilitator.getSupported());
  });

  app.post("/verify", async (req, res) => {
    const { paymentPayload, paymentRequirements } = req.body ?? {};
    const network = paymentRequirements?.network as string | undefined;
    const amount = paymentRequirements?.amount as string | undefined;

    try {
      if (!paymentPayload || !paymentRequirements) {
        analytics.capture("verify_request", undefined, {
          ok: false,
          reason: "missing_parameters",
        });
        return res.status(400).json({
          isValid: false,
          invalidReason: "missing_parameters",
          invalidMessage: "Missing paymentPayload or paymentRequirements",
        });
      }
      const result = await facilitator.verify(paymentPayload, paymentRequirements);
      analytics.capture("verify_request", result.payer, {
        ok: result.isValid,
        reason: result.invalidReason,
        network,
        amount,
      });
      res.json(result);
    } catch (err) {
      const message = (err as Error).message;
      console.error("[verify exception]", message);
      analytics.capture("verify_request", undefined, {
        ok: false,
        reason: "unexpected_error",
        error: message,
        network,
      });
      res.status(500).json({
        isValid: false,
        invalidReason: "unexpected_error",
        invalidMessage: message,
      });
    }
  });

  app.post("/settle", async (req, res) => {
    const { paymentPayload, paymentRequirements } = req.body ?? {};
    const network = paymentRequirements?.network as string | undefined;
    const amount = paymentRequirements?.amount as string | undefined;

    try {
      if (!paymentPayload || !paymentRequirements) {
        analytics.capture("settle_request", undefined, {
          ok: false,
          reason: "missing_parameters",
        });
        return res.status(400).json({
          success: false,
          errorReason: "missing_parameters",
          errorMessage: "Missing paymentPayload or paymentRequirements",
          transaction: "",
          network: "",
        });
      }
      const result = await facilitator.settle(paymentPayload, paymentRequirements);
      analytics.capture("settle_request", result.payer, {
        ok: result.success,
        reason: result.errorReason,
        network,
        amount,
        tx: result.transaction,
      });
      res.json(result);
    } catch (err) {
      const message = (err as Error).message;
      console.error("[settle exception]", message);
      analytics.capture("settle_request", undefined, {
        ok: false,
        reason: "unexpected_error",
        error: message,
        network,
      });
      res.status(500).json({
        success: false,
        errorReason: "unexpected_error",
        errorMessage: message,
        transaction: "",
        network: "",
      });
    }
  });

  app.get("/", (_req, res) => {
    const supported = facilitator.getSupported();
    res.json({
      service: "agentpay-facilitator",
      version: "0.0.1",
      feePayer: signer.address,
      networks: supported.kinds.map((k) => k.network),
      kinds: supported.kinds,
    });
  });

  app.listen(PORT, () => {
    console.log(`agentpay facilitator listening on http://localhost:${PORT}`);
    console.log(`endpoints: GET / | GET /supported | POST /verify | POST /settle`);
    console.log("---");
    console.log(
      "Before serving real settlements, fund the fee payer with SOL on each network."
    );
    console.log(`  devnet:  https://faucet.solana.com  → ${signer.address}`);
    console.log(`  mainnet: send ~0.01 SOL from any wallet → ${signer.address}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

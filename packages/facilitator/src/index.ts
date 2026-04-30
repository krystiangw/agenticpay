/**
 * agenticpay self-hosted x402 facilitator.
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
import rateLimit from "express-rate-limit";
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

// Lower bound on payment amounts we'll accept. 100 base units of USDC is
// $0.0001 — anything less is almost certainly spam, since the SOL fee paid
// on the payer's behalf already exceeds the value of the transfer.
const MIN_AMOUNT_BASE_UNITS = 100n;

// Public-facing error messages. We log the real exception internally but
// only echo a generic reason to the client, so we don't leak library-internal
// strings (file paths, lib version, etc.) that aid reconnaissance.
const GENERIC_VERIFY_ERROR =
  "Verification failed. See server logs for details.";
const GENERIC_SETTLE_ERROR =
  "Settlement failed. See server logs for details.";

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
  // Trust the Heroku/Fly.io reverse proxy so rate limiting keys on the real
  // client IP, not the load balancer's.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "256kb" }));

  // Rate limit: 60 req/min per IP for the public read endpoint.
  const readLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited", message: "Too many requests" },
  });

  // Stricter limit on the verify/settle endpoints: 30 req/min per IP. Each
  // settle costs the fee_payer SOL on-chain, so a tighter ceiling protects
  // our funds even if the network/asset checks below were bypassed.
  const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      success: false,
      errorReason: "rate_limited",
      errorMessage: "Too many requests",
    },
  });

  app.get("/supported", readLimiter, (_req, res) => {
    res.json(facilitator.getSupported());
  });

  // Reject obvious dust amounts before they reach the facilitator — we'd
  // otherwise burn SOL fees on transfers worth less than the fee.
  function checkMinAmount(
    paymentRequirements: { amount?: string } | undefined
  ): string | null {
    const raw = paymentRequirements?.amount;
    if (!raw) return null;
    try {
      const v = BigInt(raw);
      if (v < MIN_AMOUNT_BASE_UNITS) return "amount_below_minimum";
    } catch {
      return "amount_invalid";
    }
    return null;
  }

  app.post("/verify", writeLimiter, async (req, res) => {
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
      const minViolation = checkMinAmount(paymentRequirements);
      if (minViolation) {
        analytics.capture("verify_request", undefined, {
          ok: false,
          reason: minViolation,
          network,
          amount,
        });
        return res.status(400).json({
          isValid: false,
          invalidReason: minViolation,
          invalidMessage: `Amount must be >= ${MIN_AMOUNT_BASE_UNITS} base units`,
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
        invalidMessage: GENERIC_VERIFY_ERROR,
      });
    }
  });

  app.post("/settle", writeLimiter, async (req, res) => {
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
      const minViolation = checkMinAmount(paymentRequirements);
      if (minViolation) {
        analytics.capture("settle_request", undefined, {
          ok: false,
          reason: minViolation,
          network,
          amount,
        });
        return res.status(400).json({
          success: false,
          errorReason: minViolation,
          errorMessage: `Amount must be >= ${MIN_AMOUNT_BASE_UNITS} base units`,
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
        errorMessage: GENERIC_SETTLE_ERROR,
        transaction: "",
        network: "",
      });
    }
  });

  app.get("/", readLimiter, (_req, res) => {
    const supported = facilitator.getSupported();
    res.json({
      service: "agenticpay-facilitator",
      version: "0.0.1",
      feePayer: signer.address,
      networks: supported.kinds.map((k) => k.network),
      kinds: supported.kinds,
    });
  });

  app.listen(PORT, () => {
    console.log(`agenticpay facilitator listening on http://localhost:${PORT}`);
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

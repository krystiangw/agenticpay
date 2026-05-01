/**
 * @agenticpay/ai-sdk — Vercel AI SDK helpers for x402 paid tools.
 *
 * Wrap one or more paywalled HTTP endpoints into a `tools` object you can
 * pass straight into `generateText` / `streamText` / `streamUI` from the
 * Vercel AI SDK. The model decides when to invoke; this package signs the
 * x402 USDC payment, retries, settles on Solana, and returns the JSON
 * response — all transparent to the AI SDK layer.
 *
 * @example
 * ```ts
 * import { generateText } from "ai";
 * import { anthropic } from "@ai-sdk/anthropic";
 * import { createAgenticpayTools } from "@agenticpay/ai-sdk";
 * import { z } from "zod";
 *
 * const senderKeypairBytes: number[] = JSON.parse(
 *   process.env.AGENT_SOLANA_KEYPAIR_BYTES!
 * );
 *
 * const tools = await createAgenticpayTools({
 *   network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
 *   rpcUrl: "https://api.devnet.solana.com",
 *   keypairBytes: senderKeypairBytes,
 *   paidTools: {
 *     reverseString: {
 *       description: "Reverse a string. Costs 0.001 USDC via x402 on Solana.",
 *       parameters: z.object({ text: z.string() }),
 *       url: "http://localhost:4021/tools/reverse",
 *     },
 *   },
 * });
 *
 * const { text } = await generateText({
 *   model: anthropic("claude-opus-4-7"),
 *   tools,
 *   prompt: "Reverse 'agenticpay rocks'",
 * });
 * ```
 */
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import type { z } from "zod";

/**
 * Minimal duck-typed shape of `ai.tool()` so this package compiles standalone
 * without taking a hard dep on `ai`. The structural shape is the public API
 * Vercel commits to; this works against AI SDK v3, v4, and v5.
 */
export interface AISDKTool<TParams = unknown, TResult = unknown> {
  description?: string;
  parameters: z.ZodType<TParams>;
  execute: (
    args: TParams,
    options?: { abortSignal?: AbortSignal }
  ) => Promise<TResult>;
}

export interface PaidToolDefinition<TInput = unknown, TOutput = unknown> {
  /** Description shown to the model. Mention the price + currency. */
  description: string;
  /** Zod schema describing the JSON body sent in the POST. */
  parameters: z.ZodType<TInput>;
  /** Full URL of the paywalled endpoint (POST). */
  url: string;
  /**
   * Optional response transformer. Default: passes the parsed JSON straight
   * to the model. Use this if the model should see a friendlier shape than
   * what the server returns.
   */
  transformResult?: (body: unknown) => TOutput;
  /** Optional extra HTTP headers (besides Content-Type and X-PAYMENT). */
  headers?: Record<string, string>;
}

export interface CreateAgenticpayToolsConfig {
  /** CAIP-2 network identifier. Devnet: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 */
  network: `${string}:${string}`;
  /** Solana JSON-RPC URL the x402 client uses. */
  rpcUrl: string;
  /** 64-byte JSON array — the agent's Solana keypair (`solana-keygen` format). */
  keypairBytes: number[];
  /** Map of tool name to paid tool definition. */
  paidTools: Record<string, PaidToolDefinition>;
}

/**
 * Build a `tools` object suitable for `generateText({ tools })` /
 * `streamText({ tools })` from the Vercel AI SDK. Each entry is a paid HTTP
 * endpoint; the wrapped fetch handles 402 → sign → retry → settle.
 */
export async function createAgenticpayTools(
  config: CreateAgenticpayToolsConfig
): Promise<Record<string, AISDKTool>> {
  const signer = await createKeyPairSignerFromBytes(
    Uint8Array.from(config.keypairBytes)
  );
  const x402 = new x402Client();
  x402.register(
    config.network,
    new ExactSvmScheme(signer, { rpcUrl: config.rpcUrl })
  );
  const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, x402);

  const out: Record<string, AISDKTool> = {};

  for (const [name, def] of Object.entries(config.paidTools)) {
    out[name] = {
      description: def.description,
      parameters: def.parameters,
      execute: async (args, options) => {
        const res = await fetchWithPayment(def.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...def.headers },
          body: JSON.stringify(args),
          ...(options?.abortSignal ? { signal: options.abortSignal } : {}),
        });
        if (!res.ok) {
          throw new Error(
            `[@agenticpay/ai-sdk] paid call failed: ${res.status} ${res.statusText}`
          );
        }
        const body = await res.json();
        return def.transformResult ? def.transformResult(body) : body;
      },
    };
  }

  return out;
}

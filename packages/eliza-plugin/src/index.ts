/**
 * agenticpay Eliza plugin.
 *
 * Wraps Eliza agents with x402 micropayments. Use it to expose paid HTTP
 * endpoints (your own MCP server, third-party paywalled APIs) as native
 * Eliza Actions — the agent decides when to call, the plugin signs and
 * settles the USDC payment on Solana, the result lands back in the agent's
 * conversation.
 *
 * @example
 * ```ts
 * import { createAgenticpayPlugin } from "@agenticpay/eliza-plugin";
 *
 * const agentpay = createAgenticpayPlugin({
 *   network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", // devnet
 *   rpcUrl: "https://api.devnet.solana.com",
 *   keypairBytesEnvVar: "AGENT_SOLANA_KEYPAIR_BYTES", // 64-byte JSON array
 *   paidActions: [
 *     {
 *       name: "REVERSE_STRING",
 *       description: "Reverse a string. Costs 0.001 USDC.",
 *       similes: ["reverse this", "flip the text"],
 *       url: "http://localhost:4021/tools/reverse",
 *       extractInput: (msg) => ({ text: msg.content.text ?? "" }),
 *       formatOutput: (body) =>
 *         `Reversed: ${(body as { result: string }).result}`,
 *     },
 *   ],
 * });
 * ```
 */
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import type {
  ElizaAction,
  ElizaHandlerCallback,
  ElizaMemory,
  ElizaPlugin,
  ElizaRuntime,
  ElizaState,
} from "./eliza-types.js";

export type {
  ElizaAction,
  ElizaHandlerCallback,
  ElizaMemory,
  ElizaPlugin,
  ElizaRuntime,
  ElizaState,
} from "./eliza-types.js";

export interface PaidActionConfig {
  /** Eliza Action name (uppercase by convention). */
  name: string;
  /** Human-readable description shown to the model. Mention the price. */
  description: string;
  /** Phrases that should trigger this action. */
  similes?: string[];
  /** Full URL of the paywalled endpoint (POST). */
  url: string;
  /** Build the JSON body for the POST from the inbound message + state. */
  extractInput: (message: ElizaMemory, state?: ElizaState) => unknown;
  /** Render the JSON response back into a user-facing string. */
  formatOutput: (body: unknown) => string;
  /** Optional extra HTTP headers to send (besides Content-Type + X-PAYMENT). */
  headers?: Record<string, string>;
}

export interface AgenticpayPluginConfig {
  /** CAIP-2 network identifier. Devnet: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 */
  network: `${string}:${string}`;
  /** Solana JSON-RPC URL the x402 client uses to fetch blockhash, mint info, etc. */
  rpcUrl: string;
  /**
   * Name of the runtime setting / env var holding the agent's Solana keypair
   * as a 64-byte JSON array (the format `solana-keygen` writes). The plugin
   * reads it once at init time via `runtime.getSetting()`.
   */
  keypairBytesEnvVar?: string;
  /** Same value passed directly as bytes (skip the env var lookup). */
  keypairBytes?: number[];
  /** Paid endpoints exposed to the agent as Actions. */
  paidActions: PaidActionConfig[];
}

/**
 * Create the agenticpay Eliza plugin from a config object. Returns a Plugin
 * suitable for inclusion in your character / agent runtime.
 */
export function createAgenticpayPlugin(
  config: AgenticpayPluginConfig
): ElizaPlugin {
  let fetchWithPayment: typeof globalThis.fetch | null = null;

  const init: NonNullable<ElizaPlugin["init"]> = async (
    _config: Record<string, unknown>,
    runtime: ElizaRuntime
  ): Promise<void> => {
    const bytes =
      config.keypairBytes ??
      readKeypairBytesFromEnv(runtime, config.keypairBytesEnvVar);

    if (!bytes) {
      throw new Error(
        `[@agenticpay/eliza-plugin] Solana keypair missing. Set keypairBytes in config or pass keypairBytesEnvVar.`
      );
    }

    const signer = await createKeyPairSignerFromBytes(Uint8Array.from(bytes));
    const client = new x402Client();
    client.register(
      config.network,
      new ExactSvmScheme(signer, { rpcUrl: config.rpcUrl })
    );
    fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, client);
  };

  const actions: ElizaAction[] = config.paidActions.map((paid) =>
    buildPaidAction(paid, () => fetchWithPayment)
  );

  return {
    name: "agenticpay",
    description:
      "x402 USDC micropayments on Solana. Wraps paid HTTP endpoints as Eliza Actions; the agent's keypair signs each payment.",
    init,
    actions,
  };
}

function readKeypairBytesFromEnv(
  runtime: ElizaRuntime,
  envVar?: string
): number[] | undefined {
  if (!envVar) return undefined;
  const raw =
    runtime.getSetting(envVar) ??
    (typeof process !== "undefined" ? process.env[envVar] : undefined);
  if (!raw) return undefined;
  try {
    const arr = JSON.parse(raw) as number[];
    if (!Array.isArray(arr) || arr.length !== 64) return undefined;
    return arr;
  } catch {
    return undefined;
  }
}

function buildPaidAction(
  paid: PaidActionConfig,
  getFetch: () => typeof globalThis.fetch | null
): ElizaAction {
  return {
    name: paid.name,
    description: paid.description,
    similes: paid.similes ?? [],
    examples: [],
    validate: async () => true,
    handler: async (
      _runtime: ElizaRuntime,
      message: ElizaMemory,
      state?: ElizaState,
      _options?: unknown,
      callback?: ElizaHandlerCallback
    ) => {
      const fetchFn = getFetch();
      if (!fetchFn) {
        await callback?.({
          text: `[agenticpay] plugin not initialized — did the runtime call plugin.init()?`,
        });
        return;
      }

      const body = paid.extractInput(message, state);

      try {
        const res = await fetchFn(paid.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...paid.headers },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          await callback?.({
            text: `[agenticpay] paid call failed: ${res.status} ${res.statusText}`,
          });
          return;
        }
        const json = await res.json();
        await callback?.({ text: paid.formatOutput(json) });
      } catch (err) {
        await callback?.({
          text: `[agenticpay] error: ${(err as Error).message}`,
        });
      }
    },
  };
}

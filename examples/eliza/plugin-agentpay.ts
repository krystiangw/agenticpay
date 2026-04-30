/**
 * Eliza plugin sketch: monetize tool calls inside an Eliza agent via agentpay.
 *
 * Eliza (https://elizaos.ai) is a Solana-native multi-agent framework. Each
 * Eliza agent has its own keypair and can already hold SPL tokens — perfect
 * fit for x402: just wrap the HTTP fetch with our payment wrapper and any
 * Action that calls a paywalled endpoint becomes a paid action.
 *
 * Status: SKETCH. Not yet published as an Eliza plugin. Want to ship it?
 * See https://github.com/krystiangw/agentpay/issues
 *
 * Install in your Eliza agent:
 *   pnpm add @agenticpay/sdk @x402/core @x402/fetch @x402/svm @solana/kit
 */
import type { IAgentRuntime, Action } from "@elizaos/core";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";

const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const RPC_URL = "https://api.devnet.solana.com";

/**
 * Construct an agentpay-aware fetch using the Eliza agent's existing keypair.
 * Eliza stores keypair bytes under runtime.character.settings; adapt the
 * path to whatever your character config uses.
 */
async function makePayingFetch(runtime: IAgentRuntime) {
  const bytes = runtime.character.settings?.solanaKeypairBytes as
    | number[]
    | undefined;
  if (!bytes) throw new Error("solanaKeypairBytes missing in character settings");

  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(bytes));
  const client = new x402Client();
  client.register(NETWORK, new ExactSvmScheme(signer, { rpcUrl: RPC_URL }));
  return wrapFetchWithPayment(globalThis.fetch, client);
}

/** Example Eliza Action that pays 0.001 USDC per call. */
export const reverseStringAction: Action = {
  name: "REVERSE_STRING",
  description: "Reverse a string. Costs 0.001 USDC paid via x402.",
  similes: ["reverse this", "flip the text"],
  examples: [],
  validate: async () => true,
  handler: async (runtime, message, _state, _options, callback) => {
    const text = (message.content.text ?? "").trim();
    if (!text) return false;

    const fetchWithPayment = await makePayingFetch(runtime);
    const res = await fetchWithPayment("http://localhost:4021/tools/reverse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`paid tool failed: ${res.status}`);
    const body = (await res.json()) as { result: string };

    callback?.({ text: `Reversed: ${body.result}` });
    return true;
  },
};

export default {
  name: "@agenticpay/eliza-plugin",
  description: "Pay-per-tool-call micropayments for Eliza agents (x402 + Solana)",
  actions: [reverseStringAction],
};

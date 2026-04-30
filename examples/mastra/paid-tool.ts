/**
 * Mastra example: a Mastra Tool that pays per call via agentpay.
 *
 * Mastra (https://mastra.ai) is a TypeScript-first AI framework with a
 * native Tool concept. agentpay is also TypeScript-first, so the
 * integration is one wrapper.
 *
 * Install:
 *   npm install @mastra/core @agenticpay/sdk
 *   npm install @x402/core @x402/fetch @x402/svm @solana/kit zod
 */
import { readFileSync } from "node:fs";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";

const SERVER_URL = "http://localhost:4021";
const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const RPC_URL = "https://api.devnet.solana.com";

const senderBytes = JSON.parse(
  readFileSync("./wallets/sender.json", "utf-8")
) as number[];
const signer = await createKeyPairSignerFromBytes(Uint8Array.from(senderBytes));

const client = new x402Client();
client.register(NETWORK, new ExactSvmScheme(signer, { rpcUrl: RPC_URL }));
const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, client);

export const reverseStringTool = createTool({
  id: "reverse-string",
  description: "Reverse a string. Costs 0.001 USDC via x402 on Solana devnet.",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async ({ context }) => {
    const res = await fetchWithPayment(`${SERVER_URL}/tools/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: context.text }),
    });
    if (!res.ok) throw new Error(`paid tool failed: ${res.status}`);
    return (await res.json()) as { result: string };
  },
});

export const wordCountTool = createTool({
  id: "word-count",
  description: "Count words in a string. Costs 0.0005 USDC.",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ count: z.number() }),
  execute: async ({ context }) => {
    const res = await fetchWithPayment(`${SERVER_URL}/tools/word-count`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: context.text }),
    });
    return (await res.json()) as { count: number };
  },
});

/**
 * Vercel AI SDK example: a `tool()` that pays per call via agenticpay.
 *
 * Drop this into a Next.js Route Handler, edge function, or worker that
 * uses the Vercel AI SDK's `generateText` / `streamText` with tool calls.
 * The tool definition is identical to any other Vercel AI SDK tool — the
 * payment handshake is hidden inside the wrapped fetch.
 *
 * Install:
 *   npm install ai @ai-sdk/anthropic zod
 *   npm install @agenticpay/sdk @x402/core @x402/fetch @x402/svm @solana/kit
 */
import { readFileSync } from "node:fs";
import { tool } from "ai";
import { z } from "zod";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";

const SERVER_URL = process.env.AGENTPAY_SERVER_URL ?? "http://localhost:4021";
const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const RPC_URL = "https://api.devnet.solana.com";

const senderBytes = JSON.parse(
  readFileSync("./wallets/sender.json", "utf-8")
) as number[];
const signer = await createKeyPairSignerFromBytes(Uint8Array.from(senderBytes));

const x402 = new x402Client();
x402.register(NETWORK, new ExactSvmScheme(signer, { rpcUrl: RPC_URL }));
const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, x402);

export const reverseStringTool = tool({
  description:
    "Reverse a string. Costs 0.001 USDC paid via x402 on Solana devnet. Use whenever the user asks to reverse text.",
  parameters: z.object({
    text: z.string().describe("The string to reverse"),
  }),
  execute: async ({ text }) => {
    const res = await fetchWithPayment(`${SERVER_URL}/tools/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`agenticpay tool failed: ${res.status}`);
    return (await res.json()) as { result: string };
  },
});

/* Example usage in a Next.js route:

import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const { text } = await generateText({
    model: anthropic("claude-opus-4-7"),
    tools: { reverseStringTool },
    prompt,
  });
  return Response.json({ text });
}
*/

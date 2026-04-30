/**
 * LangChain.js example: a LangChain agent that pays for tool calls via agenticpay.
 *
 * Wraps an x402-paywalled HTTP endpoint as a LangChain Tool. The agent
 * decides when to call it; each invocation triggers the standard 402 →
 * sign → retry → on-chain settle flow. The LangChain layer never sees the
 * payment — it gets the result as if it were a normal tool.
 *
 * Install:
 *   npm install @agenticpay/sdk @langchain/core @langchain/anthropic
 *   npm install @x402/core @x402/fetch @x402/svm @solana/kit
 *
 * Run with: ANTHROPIC_API_KEY=sk-ant-... node --env-file=.env agent.js
 */
import { readFileSync } from "node:fs";
import { ChatAnthropic } from "@langchain/anthropic";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";

const SERVER_URL = "http://localhost:4021";
const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"; // devnet
const RPC_URL = "https://api.devnet.solana.com";

// Load Solana keypair (your agent's wallet, funded with devnet USDC)
const senderKeypairBytes = JSON.parse(
  readFileSync("./wallets/sender.json", "utf-8")
) as number[];
const signer = await createKeyPairSignerFromBytes(
  Uint8Array.from(senderKeypairBytes)
);

// One-time wiring of the x402 fetch wrapper
const x402 = new x402Client();
x402.register(NETWORK, new ExactSvmScheme(signer, { rpcUrl: RPC_URL }));
const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, x402);

// LangChain tool that hides the payment behind a regular function call
const reverseStringTool = new DynamicStructuredTool({
  name: "reverse_string",
  description:
    "Reverse a string. Costs $0.001 USDC paid via x402 on Solana devnet.",
  schema: z.object({
    text: z.string().describe("The string to reverse"),
  }),
  async func({ text }) {
    const res = await fetchWithPayment(`${SERVER_URL}/tools/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`paid tool failed: ${res.status}`);
    const body = (await res.json()) as { result: string };
    return body.result;
  },
});

const wordCountTool = new DynamicStructuredTool({
  name: "word_count",
  description: "Count words in a string. Costs $0.0005 USDC.",
  schema: z.object({ text: z.string() }),
  async func({ text }) {
    const res = await fetchWithPayment(`${SERVER_URL}/tools/word-count`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const body = (await res.json()) as { count: number };
    return String(body.count);
  },
});

// Standard LangChain agent setup — nothing payment-specific from here on
const llm = new ChatAnthropic({ model: "claude-opus-4-7", temperature: 0 });
const tools = [reverseStringTool, wordCountTool];

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant with paid tools."],
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);

const agent = await createToolCallingAgent({ llm, tools, prompt });
const executor = new AgentExecutor({ agent, tools });

const result = await executor.invoke({
  input:
    "Reverse 'agentpay rocks' and tell me how many words are in 'open source x402 wins'.",
});

console.log(result.output);

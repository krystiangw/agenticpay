/**
 * Real LLM agent that pays for tools.
 *
 * Claude (via @anthropic-ai/sdk) gets a task and two paid tools, with prices
 * baked into the tool descriptions. The model decides which tools to call.
 * Each tool invocation is routed through @x402/fetch — the wrapper hits the
 * mcp-server, gets a 402, signs a USDC payment payload, retries, and the
 * facilitator settles on-chain. We track every payment and print a running
 * total so the cost is visible.
 *
 * Prereqs:
 *  - mcp-server running on http://localhost:4021 with a devnet PAY_TO
 *  - packages/sdk/wallets/sender.json funded with devnet USDC
 *  - ANTHROPIC_API_KEY in .env (loaded via tsx --env-file)
 *
 * Run: `pnpm --filter @agenticpay/two-agent-demo agent`
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:4021";
const NETWORK: `${string}:${string}` =
  (process.env.NETWORK as `${string}:${string}` | undefined) ??
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const RPC_URL =
  process.env.SOLANA_DEVNET_RPC ?? "https://api.devnet.solana.com";
const SENDER_PATH =
  process.env.SENDER_KEYPAIR ??
  resolve(process.cwd(), "../../packages/sdk/wallets/sender.json");

const MODEL = process.env.AGENT_MODEL ?? "claude-opus-4-7";

const TOOLS: Anthropic.Tool[] = [
  {
    name: "reverse_string",
    description:
      "Reverse a string. Costs 0.001 USDC per call (paid via x402 micropayment on Solana). " +
      "Use this when the user asks to reverse text.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The string to reverse" },
      },
      required: ["text"],
    },
  },
  {
    name: "word_count",
    description:
      "Count the number of words in a string. Costs 0.0005 USDC per call. " +
      "Use this when the user asks for a word count.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The string to count words in" },
      },
      required: ["text"],
    },
  },
];

const TOOL_ROUTES: Record<string, { path: string; priceUsdc: number }> = {
  reverse_string: { path: "/tools/reverse", priceUsdc: 0.001 },
  word_count: { path: "/tools/word-count", priceUsdc: 0.0005 },
};

interface PaymentLog {
  tool: string;
  priceUsdc: number;
  elapsedMs: number;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY missing. Put it in .env at repo root and run via `pnpm --filter @agenticpay/two-agent-demo agent`."
    );
  }

  const bytes = JSON.parse(readFileSync(SENDER_PATH, "utf-8")) as number[];
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(bytes));

  const x402 = new x402Client();
  x402.register(NETWORK, new ExactSvmScheme(signer, { rpcUrl: RPC_URL }));
  const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, x402);

  const anthropic = new Anthropic();

  const userTask =
    process.argv[2] ??
    "Reverse the string 'agentpay rocks' and also tell me how many words are in 'The quick brown fox jumps over the lazy dog'.";

  console.log(`Agent wallet: ${signer.address}`);
  console.log(`Server:       ${SERVER_URL}`);
  console.log(`Model:        ${MODEL}`);
  console.log(`Task:         ${userTask}`);
  console.log();

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userTask },
  ];
  const payments: PaymentLog[] = [];

  for (let turn = 1; turn <= 5; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      const finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      console.log("Agent final answer:");
      console.log(finalText);
      break;
    }

    if (response.stop_reason !== "tool_use") {
      console.log("Unexpected stop_reason:", response.stop_reason);
      console.log(response.content);
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      const route = TOOL_ROUTES[block.name];
      if (!route) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Unknown tool: ${block.name}`,
          is_error: true,
        });
        continue;
      }

      const t0 = Date.now();
      console.log(
        `[turn ${turn}] tool_use: ${block.name}(${JSON.stringify(block.input)})  →  paying $${route.priceUsdc} USDC ...`
      );

      try {
        const res = await fetchWithPayment(SERVER_URL + route.path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(block.input),
        });
        const elapsedMs = Date.now() - t0;

        if (!res.ok) {
          const body = await res.text();
          console.log(`  ✗ ${res.status} ${res.statusText}: ${body}`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Payment/tool failed: ${res.status}`,
            is_error: true,
          });
          continue;
        }

        const body = await res.json();
        payments.push({
          tool: block.name,
          priceUsdc: route.priceUsdc,
          elapsedMs,
        });
        console.log(
          `  ✓ paid + got result in ${elapsedMs}ms: ${JSON.stringify(body)}`
        );

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(body),
        });
      } catch (err) {
        console.log(`  ✗ error: ${(err as Error).message}`);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Tool error: ${(err as Error).message}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  console.log();
  console.log("=== payments summary ===");
  if (payments.length === 0) {
    console.log("(no paid tool calls)");
  } else {
    for (const p of payments) {
      console.log(`  ${p.tool.padEnd(16)} $${p.priceUsdc.toFixed(4)} USDC   ${p.elapsedMs}ms`);
    }
    const total = payments.reduce((s, p) => s + p.priceUsdc, 0);
    console.log(`  ${"TOTAL".padEnd(16)} $${total.toFixed(4)} USDC   ${payments.length} calls`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

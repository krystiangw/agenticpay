# @agenticpay/ai-sdk

[Vercel AI SDK](https://sdk.vercel.ai) helpers for x402 paid tool calls.
Wraps paywalled HTTP endpoints into a `tools` object you can drop straight
into `generateText`, `streamText`, or `streamUI`. The model decides when to
invoke; this package signs the USDC payment, settles on Solana, returns the
result.

## Install

```bash
npm install @agenticpay/ai-sdk
# peer deps you probably already have:
npm install ai zod
```

## Usage

```ts
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createAgenticpayTools } from "@agenticpay/ai-sdk";
import { z } from "zod";

const senderKeypairBytes: number[] = JSON.parse(
  process.env.AGENT_SOLANA_KEYPAIR_BYTES!
);

const tools = await createAgenticpayTools({
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", // devnet
  rpcUrl: "https://api.devnet.solana.com",
  keypairBytes: senderKeypairBytes,
  paidTools: {
    reverseString: {
      description: "Reverse a string. Costs 0.001 USDC via x402 on Solana.",
      parameters: z.object({ text: z.string() }),
      url: "http://localhost:4021/tools/reverse",
    },
    wordCount: {
      description: "Count words in a string. Costs 0.0005 USDC.",
      parameters: z.object({ text: z.string() }),
      url: "http://localhost:4021/tools/word-count",
    },
  },
});

const { text } = await generateText({
  model: anthropic("claude-opus-4-7"),
  tools,
  prompt: "Reverse 'agenticpay rocks' and count words in 'open source wins'",
});
```

## How it works

`createAgenticpayTools()` builds an `x402Client` once per call (cached),
hydrates it with the agent's Solana keypair, and wraps `fetch` with
[`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch). Each paid tool
becomes a normal Vercel AI SDK tool — the AI SDK layer never sees the
payment plumbing.

When the model invokes the tool:

1. We POST to `url` with the model's parameters.
2. Server returns `HTTP 402` with payment requirements.
3. The wrapper signs a USDC payload using the agent's keypair.
4. Retries with `X-PAYMENT` header.
5. Facilitator settles on-chain (~1.5–2 s on devnet).
6. Server returns the result; we hand it back to the model.

## Pointing at a facilitator

Your paywalled endpoints (`url` above) are typically backed by
`@agenticpay/mcp-server` or any other x402-compatible server. Either
self-host with `@agenticpay/facilitator` or point the resource server at
the public devnet facilitator:

```
FACILITATOR_URL=https://agentpay-facilitator-e9b20a5fee6a.herokuapp.com
```

## Funding the agent

The agent only needs USDC — the facilitator's fee_payer covers the SOL gas.
For devnet:

- SOL: https://faucet.solana.com
- USDC: https://faucet.circle.com (Solana Devnet)

## Status

Pre-alpha. Devnet validated end-to-end via the
[agenticpay monorepo](https://github.com/krystiangw/agenticpay).

MIT licensed.

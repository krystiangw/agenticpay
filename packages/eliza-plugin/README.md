# @agenticpay/eliza-plugin

Pay-per-call x402 USDC micropayments for [Eliza](https://elizaos.ai) agents on Solana.

Wrap any paywalled HTTP endpoint (your own MCP server, third-party paid API)
as a native Eliza Action. The agent decides when to call it; the plugin signs
and settles the USDC payment on Solana; the result lands back in the
conversation. Sub-cent fees, sub-second finality.

## Install

```bash
pnpm add @agenticpay/eliza-plugin
# peer dep — should already be in your Eliza project
pnpm add @elizaos/core
```

## Usage

```ts
import { createAgenticpayPlugin } from "@agenticpay/eliza-plugin";

export const agentpay = createAgenticpayPlugin({
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", // devnet
  rpcUrl: "https://api.devnet.solana.com",
  // 64-byte JSON array (format `solana-keygen new` writes), exposed via
  // runtime setting or process.env.
  keypairBytesEnvVar: "AGENT_SOLANA_KEYPAIR_BYTES",
  paidActions: [
    {
      name: "REVERSE_STRING",
      description: "Reverse a string. Costs 0.001 USDC.",
      similes: ["reverse this", "flip the text"],
      url: "http://localhost:4021/tools/reverse",
      extractInput: (msg) => ({ text: msg.content.text ?? "" }),
      formatOutput: (body) =>
        `Reversed: ${(body as { result: string }).result}`,
    },
    {
      name: "WORD_COUNT",
      description: "Count words in a string. Costs 0.0005 USDC.",
      url: "http://localhost:4021/tools/word-count",
      extractInput: (msg) => ({ text: msg.content.text ?? "" }),
      formatOutput: (body) =>
        `Words: ${(body as { count: number }).count}`,
    },
  ],
});

// Register in your character / runtime config.
```

## How it works

1. At plugin `init` time we hydrate an `x402Client` from the agent's Solana
   keypair (loaded from `keypairBytesEnvVar` or `keypairBytes`).
2. Every `paidAction` becomes a native Eliza `Action`. When the model calls
   it, the plugin's wrapped `fetch`:
   - issues the request,
   - on `HTTP 402` reads the payment requirements,
   - signs a USDC payload using the agent's keypair,
   - retries with the `X-PAYMENT` header,
   - returns the response after the facilitator settles on-chain (~1.5–2 s on
     devnet).
3. The agent's reply is built by your `formatOutput(jsonBody)` callback, so
   the model never sees the payment plumbing.

## Pointing at the hosted facilitator

The endpoints you wrap are typically backed by `@agenticpay/mcp-server` or
any other x402-compatible server. Either self-host a facilitator with
`@agenticpay/facilitator`, or point at the public devnet one:

```
FACILITATOR_URL=https://agentpay-facilitator-e9b20a5fee6a.herokuapp.com
```

## Funding the agent

The agent only needs USDC — the facilitator's fee_payer pays the SOL gas.
For devnet:

- SOL: https://faucet.solana.com
- USDC: https://faucet.circle.com (Solana Devnet)

Check balance with `@agenticpay/cli`:

```bash
npx -p @agenticpay/cli agentpay balance --wallet ./agent-wallet.json --cluster devnet
```

## Status

Pre-alpha. Devnet validated end-to-end via the [agenticpay monorepo](https://github.com/krystiangw/agenticpay).
Mainnet support requires a mainnet-capable facilitator (Coinbase CDP or
self-hosted with mainnet RPC + funded fee_payer).

MIT licensed.

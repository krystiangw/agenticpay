# agentpay

**Pay-per-tool-call micropayments for AI agents.** Built on Solana, USDC, and the [x402 protocol](https://x402.org).

When agent A calls a tool exposed by agent B's MCP server, agentpay handles the
USDC micropayment over HTTP. Sub-cent fees, sub-second finality. No accounts,
no API keys, no subscriptions. The agent decides when to pay; the server
serves; everything settles on-chain.

## Live demo

A real Claude Opus agent receives a task, decides which paid tools to use,
pays autonomously via x402 micropayments on Solana, and answers the user.

```
$ pnpm --filter @agentpay/two-agent-demo agent

Agent wallet: 3rHoEumCpH8EGrr6Lq2vBKeyec6h3yPRGj2nGG2FzEfX
Server:       http://localhost:4021
Model:        claude-opus-4-7
Task:         Reverse the string 'agentpay rocks' and also tell me how many
              words are in 'The quick brown fox jumps over the lazy dog'.

[turn 1] tool_use: reverse_string({"text":"agentpay rocks"})  →  paying $0.001 USDC ...
  ✓ paid + got result in 2346ms: {"result":"skcor yaptnega"}
[turn 1] tool_use: word_count({"text":"The quick..."})  →  paying $0.0005 USDC ...
  ✓ paid + got result in 1651ms: {"count":9}

Agent final answer:
  1. Reversed string: skcor yaptnega
  2. Word count: 9 words

=== payments summary ===
  reverse_string   $0.0010 USDC   2346ms
  word_count       $0.0005 USDC   1651ms
  TOTAL            $0.0015 USDC   2 calls
```

On-chain proof (Solana devnet):
- Raw USDC transfer: [`2pRGWM6m...kipwL`](https://explorer.solana.com/tx/2pRGWM6miuKs5M1qC4ZDfWVdLCqyefsCfiSvqGbgYY15UsE4rmdMer4dZooPW8hajYGYhxAzyjB7DV8rKM9kipwL?cluster=devnet)
- x402 settlement: [`2d2HcefgJ...vkqY`](https://explorer.solana.com/tx/2d2HcefgJYmkivWvf4x3TtZENnNEwJ94c9jLHZsHaDbYmEuBGuv3RCojLzsAjsqF2CKHujgX7QaDcApSLSQAvkqY?cluster=devnet)

## Why

The current AI agent stack assumes humans hold the credit card. That breaks the
moment agents act on their own initiative — calling APIs, hiring sub-agents,
buying data, paying for compute. You can't OAuth your way through it.

Stablecoin micropayments over HTTP fix this. agentpay packages the missing
ergonomics for the MCP ecosystem specifically: any tool can declare a price,
any agent can pay it, settlement is automatic.

## Architecture

```
┌──────────────┐     1) HTTP request                   ┌─────────────┐
│   Claude /   │ ───────────────────────────────────▶ │  mcp-server │
│   GPT agent  │     2) HTTP 402 + payment requirements│  (yours)    │
│              │ ◀────────────────────────────────────│             │
│              │     3) signed USDC payload (x402)     │             │
│              │ ───────────────────────────────────▶ │             │
│              │     4) on-chain settle (~1.5s)        │ x402        │
│              │     5) tool result                    │ facilitator │
│              │ ◀────────────────────────────────────│             │
└──────────────┘                                       └─────────────┘
       │
       └─▶ Solana mainnet/devnet (USDC SPL token, sub-cent fees)
```

## Packages

| Package | What it does |
|---|---|
| `packages/sdk` | TypeScript primitives: USDC transfers, wallet management, network config |
| `packages/cli` | `agentpay` command — wallet, balance, send |
| `packages/mcp-server` | HTTP server with x402 paywall middleware. Each tool has a price. |
| `examples/two-agent-demo` | Real Claude Opus agent paying for tool calls |

## Quickstart

```bash
# 1. Install
pnpm install
pnpm -r build

# 2. Generate a wallet, fund it on devnet
node packages/cli/dist/index.js wallet new
node packages/cli/dist/index.js wallet show
# → fund SOL at https://faucet.solana.com (paste the pubkey)
# → fund USDC at https://faucet.circle.com (Solana Devnet, paste the same pubkey)

# 3. Run the smoke test (raw USDC transfer)
pnpm --filter @agentpay/sdk smoke

# 4. Start the paywalled mcp-server
PAY_TO=<recipient pubkey> pnpm --filter @agentpay/mcp-server dev

# 5. Run the live LLM agent demo (needs ANTHROPIC_API_KEY in .env)
pnpm --filter @agentpay/two-agent-demo agent
```

## Status

Pre-alpha. Devnet only for now. Mainnet support requires a facilitator that
hosts mainnet — currently Coinbase CDP or your own. See `Roadmap` below.

## Roadmap

- [x] Devnet end-to-end demo (smoke + LLM agent)
- [ ] CDP facilitator integration (mainnet via Coinbase Developer Platform)
- [ ] On-chain escrow for long-running tasks (Anchor program)
- [ ] Agent reputation registry on-chain
- [ ] Hosted facilitator service (`agentpay.com`)

## License

MIT

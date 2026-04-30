# agentpay

MCP-native pay-per-tool-call micropayments for AI agents.
Built on Solana + USDC + the x402 standard.

## Status

Pre-alpha. Active development. Do not use in production.

## What it does

When AI agent A calls a tool exposed by agent B's MCP server, agentpay handles the
USDC micropayment over HTTP using the x402 standard. Sub-cent fees, sub-second
finality on Solana. No accounts, no API keys, no subscriptions.

## Packages

- `packages/sdk` — TypeScript SDK (Solana connection, USDC transfers, x402 client/server helpers)
- `packages/cli` — `agentpay` CLI for wallet management and manual payments
- `packages/mcp-server` — MCP server template with embedded x402 payment middleware
- `examples/two-agent-demo` — Two agents paying each other for tool calls

## Roadmap

- v0.1 (now): Pure x402 pay-per-call on Solana mainnet, MCP server template, two-agent demo
- v0.2: On-chain escrow for long-running tasks (Anchor program, audited)
- v0.3: Agent reputation registry on-chain
- v1.0: x402 Foundation member, production-ready

## Stack

TypeScript only. No Rust, no custom on-chain program (yet). Uses audited components:

- `@solana/web3.js` and `@solana/spl-token` for USDC transfers
- Coinbase x402 TypeScript SDK for the payment protocol
- Anthropic MCP TypeScript SDK for tool servers

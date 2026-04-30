---
name: agentpay
description: Use this skill when the user wants to monetize an MCP server, accept payments from AI agents, set up x402 micropayments on Solana, work with the agentpay TypeScript stack, or build "agent pays for tools" flows. Triggers include phrases like "monetize my tool", "paid MCP server", "agent payments", "x402", "agentpay", "stablecoin micropayments", "USDC settlement", "hosted x402 facilitator".
---

# agentpay — pay-per-tool-call micropayments for AI agents

You are helping the user build, integrate, or troubleshoot **agentpay**, an
open-source x402 payments stack for the MCP ecosystem on Solana.

Repo: <https://github.com/krystiangw/agentpay> (MIT)
Hosted devnet facilitator: `https://agentpay-facilitator-e9b20a5fee6a.herokuapp.com`
Landing page: <https://krystiangw.github.io/agentpay/>

## Mental model

Three roles in every flow:
- **Payer** — an AI agent or its harness. Holds USDC, signs payment payloads.
- **Resource server** (`mcp-server`) — exposes paid tools behind an HTTP 402
  paywall. Each tool declares a price (e.g. `$0.001 USDC`).
- **Facilitator** — verifies signed payment payloads, submits the USDC
  transfer on-chain via Solana, pays the SOL fee on the payer's behalf.

The packages in the monorepo:

| Package | Role |
|---|---|
| `@agenticpay/sdk` | USDC + wallet primitives, network config |
| `@agenticpay/cli` | `agentpay` CLI: wallet, balance, send |
| `@agenticpay/mcp-server` | Express server with x402 paywall middleware |
| `@agenticpay/facilitator` | Self-hostable x402 facilitator (verify + settle) |

## Critical invariants (the day-1 footgun)

**Network, asset, and RPC must be consistent.** Mixing devnet network
(`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`) with mainnet USDC mint
(`EPjFW...`), or pointing the client at mainnet RPC while the facilitator
runs on devnet, produces `transaction_simulation_failed: BlockhashNotFound`.
Always verify all three line up.

| Network ID (CAIP-2) | USDC mint | RPC |
|---|---|---|
| `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (devnet) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | `https://api.devnet.solana.com` |
| `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (mainnet) | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `https://api.mainnet-beta.solana.com` |

For free experiments use devnet. The hosted facilitator at
`agentpay-facilitator-e9b20a5fee6a.herokuapp.com` supports both.

## Common tasks

### "Help me monetize an MCP server"

1. Generate a recipient (PAYEE) wallet:

   ```bash
   node packages/cli/dist/index.js wallet new --wallet ./recipient.json
   node packages/cli/dist/index.js wallet show --wallet ./recipient.json
   # → copy the printed pubkey, this is your PAY_TO
   ```

2. Start the paywalled server pointing at our hosted facilitator:

   ```bash
   PAY_TO=<recipient pubkey> \
   FACILITATOR_URL=https://agentpay-facilitator-e9b20a5fee6a.herokuapp.com \
     pnpm --filter @agenticpay/mcp-server dev
   ```

   Each tool has a price configured in `packages/mcp-server/src/index.ts`.
   Edit `routes` to add new tools or adjust `usdcDevnet(amount)` per tool.

3. Verify the paywall works:

   ```bash
   curl -i -X POST http://localhost:4021/tools/reverse \
     -H "Content-Type: application/json" -d '{"text":"hi"}'
   # → HTTP 402 Payment Required with PAYMENT-REQUIRED header
   ```

### "Help me make my agent pay for tools"

Use `@x402/fetch` from the agent side:

```typescript
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";

const signer = await createKeyPairSignerFromBytes(senderKeypairBytes);
const client = new x402Client();
client.register(
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  new ExactSvmScheme(signer, { rpcUrl: "https://api.devnet.solana.com" })
);
const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, client);

const res = await fetchWithPayment("http://server/tools/reverse", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "hello" }),
});
// First call returns 402 with payment requirements; the wrapper signs a
// USDC payload, retries, and returns the actual response after on-chain
// settlement (~1.5–2s on devnet).
```

For a full LLM-driven example (Claude Opus deciding when to pay), see
`examples/two-agent-demo/src/agent-llm.ts`.

### "Help me self-host the facilitator"

```bash
pnpm --filter @agenticpay/facilitator dev
# Note the printed feePayer address — it needs ~0.05 SOL devnet to cover fees.
pnpm --filter @agenticpay/facilitator fund   # transfers SOL from sender wallet
```

For production deployment (e.g. Heroku):

- Set `FACILITATOR_KEYPAIR_BYTES` env var to a 64-byte JSON array (the slug
  filesystem is read-only at runtime, so the on-disk fallback won't apply).
- Heroku assigns the listen port via `PORT` — the server already falls back
  to it when `FACILITATOR_PORT` is unset.

### "Verify an on-chain settlement"

After a paid call, look up the transaction:

```bash
curl -s -X POST https://api.devnet.solana.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getSignaturesForAddress","params":["<sender pubkey>",{"limit":3}]}'
```

Or open Solana Explorer: `https://explorer.solana.com/tx/<sig>?cluster=devnet`.

## When NOT to use this skill

- The user wants generic Solana / SPL token help unrelated to agent payments
- The user wants Stripe / fiat / non-crypto payment flows
- The user wants to write a brand-new payment protocol — direct them to
  upstream `@x402/core` and `@x402/svm` instead.

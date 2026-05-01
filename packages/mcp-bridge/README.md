# @agenticpay/mcp-bridge

A real **MCP server** (stdio transport, `@modelcontextprotocol/sdk`) that
exposes x402-paywalled HTTP endpoints as MCP tools. Drop into Claude
Desktop, Cursor, Continue.dev, or any MCP client.

The bridge holds a Solana keypair, signs each x402 payment payload, and
settles via a facilitator on the agent's behalf. The MCP client sees normal
MCP tools — it never touches the payment plumbing.

## Why this exists

`@agenticpay/mcp-server` is the **resource server** (the place that wants to
get paid). `@agenticpay/mcp-bridge` is the **client adapter** that makes
those paid endpoints appear as native MCP tools to AI clients that already
speak MCP.

Use case: you want Claude Desktop to be able to call paid APIs without
managing wallets or signing payments yourself. The bridge handles it.

## Install / use with Claude Desktop

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "agenticpay": {
      "command": "npx",
      "args": ["-y", "@agenticpay/mcp-bridge"],
      "env": {
        "AGENTICPAY_BRIDGE_KEYPAIR": "[12,34,...your 64-byte keypair]",
        "AGENTICPAY_BRIDGE_NETWORK": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        "AGENTICPAY_BRIDGE_RPC": "https://api.devnet.solana.com",
        "AGENTICPAY_BRIDGE_TOOLS": "[{\"name\":\"reverse_string\",\"description\":\"Reverse a string. Costs 0.001 USDC.\",\"url\":\"http://localhost:4021/tools/reverse\",\"inputSchema\":{\"text\":{\"type\":\"string\"}}}]"
      }
    }
  }
}
```

Restart Claude Desktop. The agenticpay tools (e.g. `reverse_string`) appear
in the conversation. Claude calls them; the bridge pays, settles, returns
the result.

## Programmatic use

```ts
import { createBridge } from "@agenticpay/mcp-bridge";
import { z } from "zod";

await createBridge({
  keypairBytes: [12, 34, /* ... 64 bytes */],
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  rpcUrl: "https://api.devnet.solana.com",
  tools: [
    {
      name: "reverse_string",
      description: "Reverse a string. Costs 0.001 USDC.",
      url: "http://localhost:4021/tools/reverse",
      inputSchema: { text: z.string() },
      formatResult: (body) => (body as { result: string }).result,
    },
  ],
});
```

## Funding the bridge wallet

The wallet pays USDC for every tool call. Devnet:
- SOL: https://faucet.solana.com
- USDC: https://faucet.circle.com (Solana Devnet)

The facilitator (e.g. our hosted devnet endpoint) covers SOL gas — the
bridge wallet only needs USDC.

## Status

Pre-alpha. Devnet-validated. Mainnet works once you fund the wallet with
real USDC and point at a mainnet-capable facilitator.

MIT licensed. See [agenticpay monorepo](https://github.com/krystiangw/agenticpay).

#!/usr/bin/env node
/**
 * agenticpay-mcp-bridge — stdio entry point for `npx`-style or Claude
 * Desktop integration.
 *
 * Reads the keypair, network, and tool list from env vars (see
 * loadConfigFromEnv). Connects over stdio. Logs ONLY to stderr — stdio is
 * reserved for the MCP JSON-RPC stream.
 *
 * Example Claude Desktop config:
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "agenticpay": {
 *       "command": "npx",
 *       "args": ["-y", "@agenticpay/mcp-bridge"],
 *       "env": {
 *         "AGENTICPAY_BRIDGE_KEYPAIR": "[12,34,...]",
 *         "AGENTICPAY_BRIDGE_NETWORK": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
 *         "AGENTICPAY_BRIDGE_RPC": "https://api.devnet.solana.com",
 *         "AGENTICPAY_BRIDGE_TOOLS": "[{\"name\":\"reverse_string\",\"description\":\"Reverse a string. Costs 0.001 USDC.\",\"url\":\"http://localhost:4021/tools/reverse\",\"inputSchema\":{\"text\":{\"type\":\"string\"}}}]"
 *       }
 *     }
 *   }
 * }
 * ```
 */
import { createBridge, loadConfigFromEnv } from "./index.js";

async function main() {
  try {
    const config = loadConfigFromEnv(process.env);
    if (config.tools.length === 0) {
      console.error(
        "[agenticpay-mcp-bridge] WARNING: no tools configured. Set AGENTICPAY_BRIDGE_TOOLS to a JSON array of tool defs."
      );
    } else {
      console.error(
        `[agenticpay-mcp-bridge] starting with ${config.tools.length} tool(s): ${config.tools
          .map((t) => t.name)
          .join(", ")}`
      );
    }
    await createBridge(config);
  } catch (err) {
    console.error(`[agenticpay-mcp-bridge] fatal: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();

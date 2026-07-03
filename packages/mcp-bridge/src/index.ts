/**
 * @agenticpay/mcp-bridge
 *
 * A real MCP server (stdio transport, `@modelcontextprotocol/sdk`) that
 * wraps x402-paywalled HTTP endpoints as MCP tools. Drop into Claude
 * Desktop, Cursor, Continue.dev, or any MCP client.
 *
 * The bridge holds a Solana keypair, signs each x402 payment payload, and
 * settles via a facilitator on the agent's behalf. The MCP client (e.g.
 * Claude Desktop) sees normal MCP tools — it never touches the payment
 * plumbing.
 *
 * Programmatic use:
 *
 * ```ts
 * import { createBridge } from "@agenticpay/mcp-bridge";
 * await createBridge({
 *   keypairBytes: [...],
 *   network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
 *   rpcUrl: "https://api.devnet.solana.com",
 *   tools: [
 *     {
 *       name: "reverse_string",
 *       description: "Reverse a string. Costs 0.001 USDC.",
 *       url: "http://localhost:4021/tools/reverse",
 *       inputSchema: { text: z.string() },
 *     },
 *   ],
 * });
 * ```
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { z, type ZodRawShape } from "zod";

export interface BridgeToolDefinition {
  /** MCP tool name (snake_case by convention). */
  name: string;
  /** Description shown to the model. Mention price + currency. */
  description: string;
  /** Full URL of the paywalled endpoint (POST). */
  url: string;
  /**
   * Zod object shape (a record of property name → ZodType). The MCP SDK
   * will derive the JSON Schema and validate inputs before our handler
   * runs.
   */
  inputSchema: ZodRawShape;
  /** Optional extra HTTP headers (besides Content-Type and X-PAYMENT). */
  headers?: Record<string, string>;
  /**
   * Optional response transformer. Default: stringify the JSON response
   * and return it as a single text block.
   */
  formatResult?: (body: unknown) => string;
}

export interface BridgeConfig {
  /** 64-byte Solana keypair, the format `solana-keygen new` writes. */
  keypairBytes: number[];
  /** CAIP-2 network identifier. */
  network: `${string}:${string}`;
  /** Solana JSON-RPC URL. */
  rpcUrl: string;
  /** Paid endpoints exposed as MCP tools. */
  tools: BridgeToolDefinition[];
  /** Server name shown to the MCP client. Default: "agenticpay". */
  serverName?: string;
  /** Server version. Default: "0.0.1". */
  serverVersion?: string;
  /**
   * Refuse any single payment above this amount, in base units of the
   * payment asset (USDC has 6 decimals, so "1000" = 0.001 USDC).
   * Unset = no per-call cap.
   */
  maxPaymentPerCall?: string;
  /**
   * Refuse payments once the cumulative total for this bridge process
   * would exceed this amount, in base units of the payment asset.
   * Counted when a payment is signed, so a settlement that later fails
   * still consumes budget (conservative). Unset = no session budget.
   */
  sessionBudget?: string;
}

/**
 * Build the MCP server, register every paid tool, and connect over stdio.
 * Returns once the transport closes (the parent MCP client exits).
 */
export async function createBridge(config: BridgeConfig): Promise<void> {
  const signer = await createKeyPairSignerFromBytes(
    Uint8Array.from(config.keypairBytes)
  );
  const x402 = new x402Client();
  x402.register(
    config.network,
    new ExactSvmScheme(signer, { rpcUrl: config.rpcUrl })
  );

  const perCallCap =
    config.maxPaymentPerCall !== undefined
      ? BigInt(config.maxPaymentPerCall)
      : undefined;
  const sessionBudget =
    config.sessionBudget !== undefined
      ? BigInt(config.sessionBudget)
      : undefined;
  let sessionSpent = 0n;
  if (perCallCap !== undefined || sessionBudget !== undefined) {
    // Filtering a requirement out means the client has no acceptable way to
    // pay, so the wrapped fetch rejects and the tool call surfaces an error
    // instead of silently overspending.
    x402.registerPolicy((_x402Version, requirements) =>
      requirements.filter((req) => {
        const amount = BigInt(req.amount);
        if (perCallCap !== undefined && amount > perCallCap) return false;
        if (sessionBudget !== undefined && sessionSpent + amount > sessionBudget)
          return false;
        return true;
      })
    );
    if (sessionBudget !== undefined) {
      // Reserve the budget synchronously before signing. The policy filter
      // above is only advisory: concurrent tool calls could all pass it
      // before any payment finishes, so the check-and-reserve here (atomic —
      // no await between check and update) is the actual enforcement.
      x402.onBeforePaymentCreation(async (context) => {
        const amount = BigInt(context.selectedRequirements.amount);
        if (sessionSpent + amount > sessionBudget) {
          return {
            abort: true as const,
            reason: `session budget exceeded: spent ${sessionSpent} + ${amount} > ${sessionBudget} base units`,
          };
        }
        sessionSpent += amount;
      });
    }
  }

  const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, x402);

  const server = new McpServer({
    name: config.serverName ?? "agenticpay",
    version: config.serverVersion ?? "0.0.1",
  });

  for (const tool of config.tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args) => {
        try {
          const res = await fetchWithPayment(tool.url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...tool.headers },
            body: JSON.stringify(args),
          });
          if (!res.ok) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `paid call failed: ${res.status} ${res.statusText}`,
                },
              ],
            };
          }
          const body = await res.json();
          const text = tool.formatResult
            ? tool.formatResult(body)
            : JSON.stringify(body);
          return { content: [{ type: "text", text }] };
        } catch (err) {
          return {
            isError: true,
            content: [
              { type: "text", text: `bridge error: ${(err as Error).message}` },
            ],
          };
        }
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers run until stdio closes; this resolves when the client exits.
}

/**
 * Parse a config from the standard env vars used by the CLI.
 *  - AGENTICPAY_BRIDGE_KEYPAIR — 64-byte JSON array
 *  - AGENTICPAY_BRIDGE_NETWORK — CAIP-2 (default devnet)
 *  - AGENTICPAY_BRIDGE_RPC — RPC URL (default devnet RPC)
 *  - AGENTICPAY_BRIDGE_TOOLS — JSON array of tool definitions; each tool's
 *    inputSchema is a JSON-Schema-ish object map of `{ name: { type: "string" } }`,
 *    coerced into a flat ZodRawShape (only string + number + boolean supported
 *    here for simplicity).
 *  - AGENTICPAY_BRIDGE_MAX_PER_CALL — optional per-call spend cap, base units
 *  - AGENTICPAY_BRIDGE_SESSION_BUDGET — optional cumulative spend cap, base units
 */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): BridgeConfig {
  const keypairRaw = env.AGENTICPAY_BRIDGE_KEYPAIR;
  if (!keypairRaw) {
    throw new Error(
      "AGENTICPAY_BRIDGE_KEYPAIR env var is required (64-byte JSON array)"
    );
  }
  const keypairBytes = JSON.parse(keypairRaw) as number[];
  if (!Array.isArray(keypairBytes) || keypairBytes.length !== 64) {
    throw new Error("AGENTICPAY_BRIDGE_KEYPAIR must be a 64-byte JSON array");
  }

  const network = (env.AGENTICPAY_BRIDGE_NETWORK ??
    "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1") as `${string}:${string}`;
  const rpcUrl =
    env.AGENTICPAY_BRIDGE_RPC ?? "https://api.devnet.solana.com";

  const toolsRaw = env.AGENTICPAY_BRIDGE_TOOLS ?? "[]";
  const toolsParsed = JSON.parse(toolsRaw) as Array<{
    name: string;
    description: string;
    url: string;
    inputSchema?: Record<string, { type: "string" | "number" | "boolean" }>;
    headers?: Record<string, string>;
  }>;

  const tools: BridgeToolDefinition[] = toolsParsed.map((t) => {
    const def: BridgeToolDefinition = {
      name: t.name,
      description: t.description,
      url: t.url,
      inputSchema: parseSimpleInputSchema(t.inputSchema ?? {}),
    };
    if (t.headers) def.headers = t.headers;
    return def;
  });

  const bridgeConfig: BridgeConfig = { keypairBytes, network, rpcUrl, tools };
  if (env.AGENTICPAY_BRIDGE_MAX_PER_CALL) {
    bridgeConfig.maxPaymentPerCall = parseBaseUnits(
      "AGENTICPAY_BRIDGE_MAX_PER_CALL",
      env.AGENTICPAY_BRIDGE_MAX_PER_CALL
    );
  }
  if (env.AGENTICPAY_BRIDGE_SESSION_BUDGET) {
    bridgeConfig.sessionBudget = parseBaseUnits(
      "AGENTICPAY_BRIDGE_SESSION_BUDGET",
      env.AGENTICPAY_BRIDGE_SESSION_BUDGET
    );
  }
  return bridgeConfig;
}

function parseBaseUnits(name: string, value: string): string {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `${name} must be a non-negative integer in base units of the payment asset (USDC: "1000" = 0.001), got: ${value}`
    );
  }
  return value;
}

function parseSimpleInputSchema(
  schema: Record<string, { type: "string" | "number" | "boolean" }>
): ZodRawShape {
  // ZodRawShape is Readonly in zod 4, so build a mutable record first.
  const out: Record<string, z.ZodType> = {};
  for (const [key, def] of Object.entries(schema)) {
    if (def.type === "string") out[key] = z.string();
    else if (def.type === "number") out[key] = z.number();
    else if (def.type === "boolean") out[key] = z.boolean();
  }
  return out;
}

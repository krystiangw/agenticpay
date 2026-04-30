# Framework integrations

These examples show how to wire `@agenticpay/sdk` into the most popular AI
agent frameworks. Each one assumes you already have:

1. The mcp-server running locally (or a public URL): see `packages/mcp-server`.
2. A Solana keypair funded with USDC (and the recipient ATA initialized) on
   devnet for the network you're targeting: see `packages/sdk/src/smoke.ts`.
3. (For the LLM examples) `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `.env`.

| Folder | Framework | Status |
|---|---|---|
| `two-agent-demo/` | Anthropic SDK + custom loop | ✅ working, used in CI |
| `langchain-js/` | LangChain.js | reference only |
| `langchain-python/` | LangChain (Python) | sketch — needs Python x402 client |
| `eliza/` | Eliza (Solana-native AI agents) | sketch — port to plugin format |
| `mastra/` | Mastra | reference only |
| `vercel-ai-sdk/` | Vercel AI SDK | reference only |
| `openai-gpt/` | OpenAI Custom GPTs | OpenAPI 3 action schema |

The `two-agent-demo/` is the canonical, runnable example. The others are
templates that should compile against their respective frameworks once the
listed dependencies are installed; they are not wired into the workspace
`pnpm install` to keep the dep tree small. Copy the file out, install the
deps in a fresh project, and adapt to your character/agent config.

## Wanted: full integrations

If you want to land a first-class plugin in any of these ecosystems
(`@agenticpay/langchain`, `@agenticpay/eliza-plugin`, etc.), please open an
issue or PR — happy to ship them quickly.

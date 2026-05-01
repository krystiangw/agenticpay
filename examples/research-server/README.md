# research-server

Real-world template for an x402-paywalled MCP server. Unlike the toy
`reverse_string` in `packages/mcp-server`, the four tools here are backed
by **real Claude API calls** — the agent calling them gets actual research
output (summaries, entity extraction, sentiment, translation), the kind of
thing someone would pay for in production.

Use this as a starting point for your own paid MCP server. Replace the
Claude calls with whatever your service actually does.

## Tools

| Route                       | Price (USDC) | What it does                          |
|-----------------------------|-------------:|---------------------------------------|
| `POST /tools/summarize`     |       0.005 | Summarize text (short/medium/long)    |
| `POST /tools/extract_entities` |    0.003 | Pull people/orgs/locations as JSON    |
| `POST /tools/sentiment`     |       0.001 | Classify as positive/negative/neutral |
| `POST /tools/translate`     |       0.005 | Translate text to target language     |

Pricing tiers loosely reflect real backend cost: token-heavy outputs
(summarize, translate) cost more than single-token classifiers (sentiment).

## Run

```bash
PAY_TO=<recipient pubkey> \
ANTHROPIC_API_KEY=sk-ant-... \
  pnpm --filter @agenticpay/example-research-server dev
```

By default the server listens on `:4022`, points at the hosted devnet
facilitator, and uses `claude-haiku-4-5-20251001` as the backend (cheap
and fast). Override via env: `PORT`, `FACILITATOR_URL`, `NETWORK`, `MODEL`.

## Verify the paywall

```bash
curl -i -X POST http://localhost:4022/tools/sentiment \
  -H "Content-Type: application/json" \
  -d '{"text":"I love agenticpay"}'
# → HTTP/1.1 402 Payment Required, with PAYMENT-REQUIRED header
```

## Drive it from an agent

Adapt `examples/two-agent-demo/src/agent-llm.ts`: change `SERVER_URL` to
`http://localhost:4022`, replace the `TOOLS` array with the four routes
above, and update each tool's `extractInput` / `formatOutput` to match.

The agent will autonomously decide which paid tool to call for a given
research task ("summarize this article", "what's the sentiment of this
review", "translate this to Polish") — and pay $0.001–$0.005 per call.

## Why this matters

The point of paid agent tools isn't to charge for trivial operations.
It's to make **specialized, expensive, or proprietary backend logic**
discoverable and consumable by autonomous agents without the
provider building Stripe integration + auth + rate limiting from
scratch.

This template shows what a real paid MCP server looks like once you go
past Hello World.

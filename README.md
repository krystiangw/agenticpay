# agenticpay

[![CI](https://github.com/krystiangw/agenticpay/actions/workflows/ci.yml/badge.svg)](https://github.com/krystiangw/agenticpay/actions/workflows/ci.yml)
[![CodeQL](https://github.com/krystiangw/agenticpay/actions/workflows/codeql.yml/badge.svg)](https://github.com/krystiangw/agenticpay/actions/workflows/codeql.yml)
[![gitleaks](https://github.com/krystiangw/agenticpay/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/krystiangw/agenticpay/actions/workflows/gitleaks.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/krystiangw/agenticpay?style=flat&logo=github&color=yellow)](https://github.com/krystiangw/agenticpay/stargazers)
[![npm: @agenticpay/sdk](https://img.shields.io/npm/v/@agenticpay/sdk?label=npm%20%40agenticpay%2Fsdk)](https://www.npmjs.com/package/@agenticpay/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@agenticpay/sdk?label=downloads)](https://www.npmjs.com/package/@agenticpay/sdk)

**Get paid by AI agents.** Open-source payment infrastructure for the MCP
ecosystem — declare a price on any tool, agents pay in USDC over [x402](https://x402.org),
settles on Solana in ~1.5 seconds.

No Stripe. No accounts. No API keys.

The full stack is here — SDK, CLI, paywall middleware, **self-hosted x402
facilitator**, and a live LLM agent demo. All TypeScript, MIT licensed.

> **Just want to test it?** Point your `mcp-server` at our hosted devnet
> facilitator: `FACILITATOR_URL=https://agentpay-facilitator-e9b20a5fee6a.herokuapp.com`
> — no setup needed.

## Live demo

A real Claude Opus agent receives a task, decides which paid tools to use,
pays autonomously via x402 micropayments on Solana, and answers the user.

```
$ pnpm --filter @agenticpay/two-agent-demo agent

Agent wallet: 3rHoEumCpH8EGrr6Lq2vBKeyec6h3yPRGj2nGG2FzEfX
Server:       http://localhost:4021
Facilitator:  http://localhost:4022   ← our own
Model:        claude-opus-4-7
Task:         Reverse the string 'agentpay rocks' and tell me how many words
              are in 'The quick brown fox jumps over the lazy dog'.

[turn 1] tool_use: reverse_string({"text":"agenticpay rocks"})  →  paying $0.001 USDC ...
  ✓ paid + got result in 1596ms: {"result":"skcor yaptnega"}
[turn 1] tool_use: word_count({"text":"The quick..."})  →  paying $0.0005 USDC ...
  ✓ paid + got result in 1286ms: {"count":9}

Agent final answer:
  1. Reversed string: skcor yaptnega
  2. Word count: 9 words

=== payments summary ===
  reverse_string   $0.0010 USDC   1596ms
  word_count       $0.0005 USDC   1286ms
  TOTAL            $0.0015 USDC   2 calls
```

On-chain proof (Solana devnet):
- Settled by our self-hosted facilitator: [`EsqzTG8id...Bnku`](https://explorer.solana.com/tx/EsqzTG8id5CF5yxXmSSictkJnqn1uVC514joHqVBpdfSy4MkzvGzGGdb7Fybkn5ruSGyCQ87jyjmHuSGpU2Bnku?cluster=devnet)
- Earlier settle via x402.org: [`2d2HcefgJ...vkqY`](https://explorer.solana.com/tx/2d2HcefgJYmkivWvf4x3TtZENnNEwJ94c9jLHZsHaDbYmEuBGuv3RCojLzsAjsqF2CKHujgX7QaDcApSLSQAvkqY?cluster=devnet)

## Why

The current AI agent stack assumes humans hold the credit card. That breaks
the moment agents act on their own initiative — calling APIs, hiring
sub-agents, paying for compute. You can't OAuth your way through it.

Stablecoin micropayments over HTTP fix it. agenticpay packages the missing
ergonomics for the MCP ecosystem specifically: any tool can declare a price,
any agent can pay it, and the whole pipeline — including the facilitator that
actually submits the on-chain settlement — is open source and self-hostable.

## Architecture

```
┌──────────────┐     1) HTTP request                    ┌─────────────┐
│   Claude /   │ ────────────────────────────────────▶ │  mcp-server │
│   GPT agent  │     2) HTTP 402 + payment requirements │  (yours)    │
│              │ ◀──────────────────────────────────── │             │
│              │     3) signed USDC payload             │             │
│              │ ────────────────────────────────────▶ │             │
└──────────────┘                                        └─────┬───────┘
                                                              │ verify+settle
                                                              ▼
                                                   ┌──────────────────────┐
                                                   │ agenticpay facilitator │
                                                   │   (also yours, this  │
                                                   │    repo, port 4022)  │
                                                   └──────────┬───────────┘
                                                              │ submit
                                                              ▼
                                                          Solana
                                                       (USDC SPL,
                                                       sub-cent fees)
```

You can also point `mcp-server` at the public `x402.org/facilitator` for
testnet/devnet, or at Coinbase CDP for mainnet. We just made the
self-hosted route easy.

## Packages

| Package | What it does |
|---|---|
| `packages/sdk` | TypeScript primitives: USDC transfers, wallet management, network config |
| `packages/cli` | `agenticpay` command — wallet, balance, send |
| `packages/mcp-server` | HTTP server with x402 paywall middleware. Each tool has a price. |
| `packages/facilitator` | **Self-hosted x402 facilitator** — verify + settle USDC payments on Solana. Pays SOL fees on behalf of agents. |
| `packages/eliza-plugin` | **Eliza plugin** — wraps paid HTTP endpoints as native Eliza Actions. Solana-native AI agents pay per tool call. |
| `packages/ai-sdk` | **Vercel AI SDK helpers** — drop paid tools straight into `generateText` / `streamText`. |
| `examples/two-agent-demo` | Real Claude Opus agent paying for tool calls |

## Install

```bash
npm install @agenticpay/sdk           # Solana + USDC primitives
npm install -g @agenticpay/cli        # `agenticpay` command
npm install @agenticpay/mcp-server    # paywalled HTTP server
npm install @agenticpay/facilitator   # self-hosted x402 facilitator
npm install @agenticpay/eliza-plugin  # Eliza plugin (Solana-native agents)
npm install @agenticpay/ai-sdk        # Vercel AI SDK paid tools
```

Or clone the monorepo to get the live two-agent demo and edit-friendly
templates (recommended for first run — see Quickstart below).

## Use with Claude Code

This repo ships an [Anthropic Skill](https://docs.claude.com/en/docs/claude-code/skills)
at `.claude/skills/agenticpay/SKILL.md`. Copy it into your `~/.claude/skills/`
to give Claude Code first-class context about agenticpay — it'll then walk you
through monetizing an MCP server, generating tool routes, and verifying
on-chain settlements without re-reading the README every time.

```bash
mkdir -p ~/.claude/skills
cp -r .claude/skills/agenticpay ~/.claude/skills/
```

## Quickstart (devnet, ~5 minutes, free)

```bash
# 1. Install
pnpm install
pnpm -r build

# 2. Generate a payer wallet, fund it on devnet
node packages/cli/dist/index.js wallet new
node packages/cli/dist/index.js wallet show
# → fund SOL at https://faucet.solana.com  (paste pubkey)
# → fund USDC at https://faucet.circle.com (Solana Devnet, same pubkey)

# 3. (option A — fastest) Use our hosted devnet facilitator. Skip step 4.
export FACILITATOR_URL=https://agentpay-facilitator-e9b20a5fee6a.herokuapp.com

# 3. (option B — fully self-hosted) Start your own facilitator (terminal 1)
pnpm --filter @agenticpay/facilitator dev
# Note the printed feePayer address. It needs ~0.05 SOL devnet to cover fees.
# Either airdrop or use the helper:
pnpm --filter @agenticpay/facilitator fund
export FACILITATOR_URL=http://localhost:4022

# 4. Start the paywalled mcp-server (terminal 2)
PAY_TO=<recipient pubkey> pnpm --filter @agenticpay/mcp-server dev

# 5. Run the live LLM agent demo (terminal 3, needs ANTHROPIC_API_KEY in .env)
pnpm --filter @agenticpay/two-agent-demo agent
```

## Framework integrations

Drop-in templates for the most common AI agent stacks live under `examples/`:

| Framework | File |
|---|---|
| Anthropic SDK (canonical) | `examples/two-agent-demo/src/agent-llm.ts` |
| LangChain.js | `examples/langchain-js/agent-with-paid-tools.ts` |
| LangChain Python | `examples/langchain-python/agent_with_paid_tools.py` |
| Eliza (Solana-native) | `examples/eliza/plugin-agenticpay.ts` |
| Mastra | `examples/mastra/paid-tool.ts` |
| Vercel AI SDK | `examples/vercel-ai-sdk/paid-tool.ts` |
| OpenAI Custom GPT | `examples/openai-gpt/action-schema.json` |

See `examples/README.md` for the integration matrix.

## Status

Pre-alpha. Devnet validated end-to-end. Mainnet config supported but requires
funding the facilitator with real SOL and pointing at a mainnet-capable RPC
(Helius, QuickNode, etc.).

## Roadmap

- [x] Devnet end-to-end demo (smoke + LLM agent)
- [x] Self-hosted x402 facilitator (verify + settle, fee_payer abstraction)
- [ ] Real-world MCP server template (search, fetch, summarize, extract — instead of toy `reverse_string`)
- [ ] On-chain escrow for long-running tasks (Anchor program)
- [ ] Agent reputation registry on-chain
- [ ] Hosted facilitator service (`agenticpay.com`)

## What's a facilitator?

If you've never seen x402 before: the **facilitator** is the trusted middleman
that (1) verifies an agent's signed payment payload, (2) submits the USDC
transfer on-chain, and (3) pays the SOL gas fees so the agent doesn't need
any SOL — only USDC. Most MCP devs don't want to run their own; they point
at a hosted one.

This repo ships a complete facilitator implementation. You can self-host it,
fork it, audit it, or deploy it as a service for your own users.

## License

MIT

# Performance & cost

Numbers below come from real on-chain settlements on Solana devnet during
the launch validation runs (2026-04-30, agenticpay v0.0.1). Mainnet
numbers will be similar but depend on the RPC and facilitator chosen.

## End-to-end latency (per paid tool call)

Wall-clock timing of `agent.tool_call() → 402 → sign → settle on-chain → response`:

| Stage                             | Median | Notes                             |
|-----------------------------------|-------:|-----------------------------------|
| Initial HTTP request to mcp-server |    5 ms | localhost                         |
| `402 Payment Required` response   |   <1 ms | payment requirements built        |
| Client x402 payload signing       |  100 ms | `@x402/svm` builds + signs the SPL transfer instruction |
| `/verify` round trip (facilitator)|   80 ms | local facilitator; 110-200 ms over Heroku |
| `/settle` (sub-second on Solana)  | 1.0–1.6 s | dominated by Solana network confirm |
| Tool handler runtime               | varies | typically <50 ms for trivial tools |
| **Total (typical paid call)**     | **1.6–2.1 s** | most of it is on-chain settle |

Sample reproducible numbers from `examples/two-agent-demo`:

```
[turn 1] tool_use: reverse_string  →  paying $0.001 USDC ...
  ✓ paid + got result in 1596 ms
[turn 1] tool_use: word_count      →  paying $0.0005 USDC ...
  ✓ paid + got result in 1286 ms

=== payments summary ===
  reverse_string   $0.0010 USDC   1596 ms
  word_count       $0.0005 USDC   1286 ms
  TOTAL            $0.0015 USDC   2 calls
```

## Cost breakdown per call

For a $0.001 USDC paid call settled by an agenticpay facilitator on Solana:

| Item                              |        Amount |
|-----------------------------------|--------------:|
| Payer USDC out                    |  1,000 base units ($0.001) |
| Recipient USDC in                 |  1,000 base units ($0.001) |
| Solana base tx fee                | 5,000 lamports (~$0.00075) |
| ATA creation (if recipient is new)|        ~0.002 SOL (~$0.30, one-time) |
| **Fee paid by**                   | **the facilitator** (`feePayer` in `extra`) |

The payer wallet only needs USDC. The facilitator's SOL covers gas. After
the recipient's ATA exists, marginal cost is just the 5k-lamport tx fee.

## Hosted facilitator throughput

Devnet hosted facilitator at
`agentpay-facilitator-e9b20a5fee6a.herokuapp.com`, 1× Heroku Standard-1X
dyno:

| Metric                        | Observed                   |
|-------------------------------|----------------------------|
| `/supported` 100 req burst    | All `200`                  |
| `/supported` 100 req sustained| 60 × `200`, 40 × `429` (rate-limited as designed) |
| `/verify` `200` latency       | 84–113 ms                  |
| `/settle` `200` latency       | 1.07–2.09 s (Solana confirm) |
| Body size limit               | 256 KB (returns `413` above) |
| Replay protection             | Solana-native: 150-slot blockhash + 16-byte memo nonce + on-chain signature dedup |

## Throughput planning

Solana mainnet processes ~60 k tx/s capacity. Per-program/per-account write
locks make the practical number for one fee_payer wallet much lower —
plan for ~50–100 settlements per second per facilitator instance, with
multiple facilitator wallets behind a load balancer if you need more.

For the hosted devnet endpoint we run today, treat it as ~10 settlements
per second sustainable. That's plenty for early-stage development; for
production traffic, self-host with `@agenticpay/facilitator` and your own
Helius / QuickNode mainnet RPC.

## Where the time goes

> "Why is a paid call slower than a free HTTP call?"

The dominating cost (1.0–1.6 s) is **on-chain confirmation** — the time
between submitting the signed transaction and the network confirming it.
That's an unavoidable property of a settled-on-L1 payment, and is an
order of magnitude faster than any card-network alternative. There is
no useful way to make this faster without skipping settlement (which
defeats the point) or moving to a faster L2.

If you want zero on-chain latency, look at *promise-of-payment* models
(payer signs an off-chain authorization; resource server serves
immediately; settle in batch later). agenticpay does not currently
implement that, but the architecture allows for it as a future
`payment-promise` scheme.

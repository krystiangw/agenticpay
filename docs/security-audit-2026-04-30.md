# Security audit — 2026-04-30

This is an internal pre-launch security audit of the agenticpay stack
(repo, four published npm packages, hosted facilitator on Heroku, static
landing on GitHub Pages, PostHog analytics). It documents threat model,
findings, mitigations applied in this review, and follow-up work.

## Scope

- Source code in this repository (commits up to `b397248` plus the audit
  fix commit landing alongside this report).
- npm packages published under `@agenticpay/*` (sdk, cli, mcp-server,
  facilitator), version 0.0.1.
- Hosted facilitator at `https://agentpay-facilitator-e9b20a5fee6a.herokuapp.com`.
- GitHub Pages landing at `https://krystiangw.github.io/agenticpay/`.
- GitHub Actions workflows (CI, CodeQL, gitleaks).

## Threat model

The hosted facilitator is the highest-value target:

1. **Fee-payer SOL drain.** Facilitator's keypair holds a small amount of
   SOL to cover settlement fees. An attacker that floods us with valid-but-
   useless payment payloads, or with payloads we settle without ever being
   able to recoup the gas, drains that wallet over time.
2. **Service disruption.** A trivial DoS makes the hosted facilitator
   unreliable, eroding trust in the brand on day one.
3. **Information disclosure.** Stack traces, library version strings, or
   keypair material in logs aid reconnaissance and attacks.
4. **Supply-chain compromise.** A malicious package published under
   `@agenticpay/*` (ours hijacked, or a typosquat) reaches every consumer.
5. **Repository compromise.** Push access on `main` lets an attacker ship
   malicious code that auto-deploys to Heroku via the existing pipeline.

## P0 findings

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | Gitleaks deep scan across full history (14 commits) | none | clean — no secrets in history |
| 2 | Inspected published npm tarballs — only `dist/`, `package.json`, `LICENSE` ship; deep grep for `sk-`, `npm_`, `phc_`, base58 keys, 64-byte arrays returned nothing | none | clean |
| 3 | Heroku application logs over 7 days: no `FACILITATOR_KEYPAIR_BYTES`, `POSTHOG_API_KEY`, or other secrets ever printed; only the standard Heroku audit "Set X config var" entries (visible only to the operator) | none | clean |
| 4 | **No rate limiting** on the hosted facilitator: 100 requests over 2 seconds all returned `200`. A naive flooder could exhaust the fee-payer wallet, or just hold the dyno hostage. | **HIGH** | **fixed**: added `express-rate-limit` — 60 req/min per IP on `/` and `/supported`, 30 req/min per IP on `/verify` and `/settle`. `app.set('trust proxy', 1)` so the rate limiter keys on the real client IP behind the Heroku router. |
| 5 | Body size limit. Tested with a 10 MB payload — server correctly returned `413` (handled by `express.json({ limit: '256kb' })`). | none | clean |
| 6 | `/verify` and `/settle` echoed library-internal error messages on unhandled exceptions ("No facilitator registered for scheme: undefined and network: solana:fake"). Mild reconnaissance leak. | LOW | **fixed**: generic error message returned to clients (`Verification failed. See server logs for details.`); the real exception is still logged server-side and emitted to PostHog with the original message in the `error` property. |
| 7 | Replay attack protection. The `@x402/svm` exact scheme builds each payment payload with (a) a Solana transaction whose `recentBlockhash` is valid for ~150 slots (~60 s), (b) a 16-byte random memo nonce, and (c) on-chain Solana signature deduplication that rejects any signature already seen. We do **not** need an application-level replay cache. | none | clean |

Additional protocol-level checks:

- **Dust amount drain.** A payer can post a payment requirement of `amount: 1`
  (one base unit, $0.000001 USDC). Settling that costs us ~5,000 lamports
  (~$0.00075) — we'd burn roughly 750× the value of the transfer in fees.
  **Fixed**: minimum amount is now `100` base units ($0.0001) at the
  facilitator. Dust requests get `400 amount_below_minimum` before they
  reach the underlying scheme.

## P1 findings

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 8 | Default CORS (no headers) is fine for our use case (server-to-server: `mcp-server` calls facilitator, browsers can't directly invoke `/verify` or `/settle` cross-origin). Documented; no change. | informational | document |
| 9 | Network whitelist on `/verify` and `/settle`. The `x402Facilitator` only registers `solana:EtWTRABZaYq...` (devnet) and `solana:5eykt4UsFv8P8...` (mainnet); unknown networks return an error from the underlying scheme. After P0.6 the response is sanitized so the network is not echoed back as a raw string. Net effect: unknown networks are rejected, generic `unexpected_error` returned. | LOW | acceptable |
| 10 | Minimum amount floor | merged into P0 above | fixed |
| 11 | Branch protection on `main` was disabled. | MEDIUM | **fixed**: enabled via GitHub API. Required status check: `typecheck + build`. Force pushes blocked. Deletes blocked. Admin override permitted (single-maintainer repo). |
| 12 | CLI `saveKeypair()` writes wallet files with `mode: 0o600` (read/write owner-only). | none | clean |
| 13 | GitHub Actions workflow permissions. `ci.yml` and `gitleaks.yml` previously inherited the repository default (`contents: write`) and would have allowed an attacker who hijacked any action step to push commits. `codeql.yml` already restricted itself. | LOW | **fixed**: explicit `permissions: contents: read` on both `ci.yml` and `gitleaks.yml`. CodeQL keeps its existing `security-events: write` which is required for upload-sarif. |
| 14 | Dependabot vulnerability alerts and automated security fixes were **disabled**. | MEDIUM | **fixed**: both enabled via `gh api PUT /vulnerability-alerts` and `/automated-security-fixes`. Existing Dependabot config (`.github/dependabot.yml`) opens grouped weekly updates. |
| - | Secret scanning + push protection (free for public repos) was off. | MEDIUM | **fixed**: enabled via repo `security_and_analysis` PATCH. Push protection now blocks commits containing recognized secret patterns at `git push`. |

## P2 findings (operational, follow-up)

| # | Item | Status |
|---|---|---|
| 15 | Sentry / structured error tracking on the facilitator (currently `console.error`) | TODO — open issue |
| 16 | `/healthz` health-check endpoint + uptime monitoring (Pingdom/Healthchecks.io) | TODO |
| 17 | Heroku autoscaling alerts when dyno hits CPU/memory ceiling | TODO |
| 18 | Fee-payer key rotation runbook (currently the keypair is set as a Heroku config var; rotating means generating a new keypair, transferring leftover SOL, updating `FACILITATOR_KEYPAIR_BYTES`) | TODO — document |
| 19 | Solana RPC failover (currently hard-coded public devnet/mainnet endpoints; should fall back across Helius / QuickNode / public if primary fails) | TODO |
| 20 | Pre-publish CI gate that runs `npm pack --dry-run` and asserts no unexpected files are about to ship | TODO |

## Tests run as part of this audit

- `gitleaks detect` over full git history — no leaks.
- `npm pack` for each of `@agenticpay/{sdk,cli,mcp-server,facilitator}` followed
  by `tar -tzf` and recursive grep for secret patterns — clean.
- 7-day Heroku log dump grepped for `FACILITATOR_KEYPAIR_BYTES`, `POSTHOG_API_KEY`,
  `NPM_TOKEN`, `sk-ant-`, `sk-`, `phc_`, 64-byte arrays, stack traces — clean.
- Live attacks against `https://agentpay-facilitator-e9b20a5fee6a.herokuapp.com`:
  10 MB POST → 413, empty body → 400, malformed JSON → 400, fake-network
  payload → response sanitized after fix, 100-req parallel burst → would have
  passed before P0.4 fix; verified post-deploy in the next section.

## Disclosure

We have a [SECURITY.md](../SECURITY.md) with a mailto disclosure path
(`gwizdala.kr@gmail.com`). Acknowledgement target is 72 h, triage 7 days.

## Next audit

Plan to repeat this audit before mainnet launch and after each significant
new endpoint or scheme addition.

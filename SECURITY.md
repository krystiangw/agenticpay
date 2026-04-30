# Security Policy

agentpay handles real money flows (USDC settlement on Solana). We take
security seriously and welcome responsible disclosure.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security bugs.**

Instead, email **gwizdala.kr@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce (code, commands, or PoC if possible)
- Affected component (`packages/sdk`, `packages/cli`, `packages/mcp-server`,
  `packages/facilitator`, or hosted facilitator at
  `agentpay-facilitator-e9b20a5fee6a.herokuapp.com`)
- Your assessment of impact (loss of funds, denial of service, info leak, etc.)

You should expect:

- An acknowledgement within **72 hours**
- A triage assessment within **7 days**
- A fix or mitigation timeline shared with you before public disclosure
- Public credit in the fix commit / release notes (unless you prefer
  anonymity)

## Scope

In scope:

- Source code in this repository
- Build / install / runtime artifacts produced from this repository
- Our hosted devnet facilitator endpoint

Out of scope:

- Vulnerabilities in upstream dependencies (`@x402/*`, `@solana/*`,
  `@anthropic-ai/sdk`, etc.) — please report those to the upstream projects
  directly. We will then update our pin once a fix is available.
- Social engineering, phishing, or attacks against contributor accounts
- Issues that require a compromised developer machine

## Key Handling

- **Wallet keypairs are never committed.** `wallets/` is in `.gitignore`. The
  hosted facilitator stores its fee-payer keypair as a Heroku config var
  (`FACILITATOR_KEYPAIR_BYTES`), not on disk.
- The hosted facilitator's fee-payer is **devnet only** at this stage. It
  holds a small amount of devnet SOL (worthless test tokens) to cover
  settlement fees on behalf of payers. A successful compromise would lose
  that test SOL — no real funds at risk.
- **Mainnet support is not yet enabled in production.** When it is, the
  fee-payer rotation policy and operational details will be documented here.

## Status

Pre-alpha software. Devnet only. Do not use in production with real funds
until we ship a tagged stable release and an audit-ready security review.

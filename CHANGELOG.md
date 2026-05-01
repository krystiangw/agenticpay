# Changelog

All notable changes to agenticpay are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to semver once it leaves pre-alpha.

## [Unreleased]

## 2026-05-01 — pre-alpha launch+1

### Added

- `@agenticpay/mcp-bridge@0.0.2` — real MCP server (stdio transport via
  `@modelcontextprotocol/sdk`) wrapping x402 paid tools. Drop into Claude
  Desktop, Cursor, or any MCP client. CLI: `npx -y @agenticpay/mcp-bridge`.
- `@agenticpay/ai-sdk@0.0.1` — Vercel AI SDK helpers
  (`createAgenticpayTools`) so Next.js / Edge Functions agents can drop paid
  tools into `generateText` / `streamText`.
- `@agenticpay/eliza-plugin@0.0.1` — Eliza framework integration
  (`createAgenticpayPlugin`) wrapping paid HTTP endpoints as native Eliza
  Actions.
- `.github/workflows/mcp-registry-publish.yml` — auto-publish to the
  Anthropic MCP Registry on every GitHub release, via OIDC (no PAT, no
  browser flow).
- `server.json` — MCP Registry metadata published as
  `io.github.krystiangw/agenticpay`.
- `.cursorrules` — Cursor users dropping this file into their repo get
  agenticpay context for free.
- `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`
  — repo polish for outside contributors.

### Distribution

- Submitted to `xpaysh/awesome-x402` (PR #312), `Merit-Systems/awesome-x402`
  (PR #169), `michielpost/x402-dev` (PR #25), `punkpeye/awesome-mcp-servers`
  (PR #5662). All open at time of writing.
- `appcypher/awesome-mcp-servers` listed agenticpay automatically (their
  pipeline scrapes from GitHub `mcp` topic).
- Anthropic MCP Registry: live at
  <https://registry.modelcontextprotocol.io/v0/servers?search=agenticpay>.

## 2026-04-30 — pre-alpha launch

### Added

- `@agenticpay/sdk@0.0.1` — TypeScript primitives: USDC transfers, wallet
  management, network config helpers.
- `@agenticpay/cli@0.0.1` — `agentpay` CLI (`wallet new`, `balance`, `send`).
- `@agenticpay/mcp-server@0.0.1` — Express HTTP server with x402 paywall
  middleware. Each tool declares a price; payments verified+settled via a
  facilitator before the route runs.
- `@agenticpay/facilitator@0.0.1` — first open-source self-hostable x402
  facilitator for Solana. Verify + settle endpoints, `feePayer` abstraction
  so payers send only USDC. Deployed at
  `agentpay-facilitator-e9b20a5fee6a.herokuapp.com` (devnet).
- `examples/two-agent-demo` — Claude Opus paying autonomously for tool
  calls. On-chain TX hashes documented in README.
- Static landing page at <https://krystiangw.github.io/agenticpay/>.
- PostHog analytics on the landing page and in the facilitator backend
  (anonymous, payer pubkeys hashed before use as distinctId).
- Security pack: `SECURITY.md`, Dependabot alerts + auto-security-fixes,
  CodeQL + gitleaks workflows, branch protection on `main`, secret scanning.
- Audit report: `docs/security-audit-2026-04-30.md` covering threat model,
  P0/P1 findings, and mitigations applied.

### Security hardening (P0/P1)

- `express-rate-limit`: 60 req/min per IP on read endpoints, 30 req/min on
  `/verify` and `/settle` (protects fee_payer SOL from drain).
- Minimum payment amount enforced at the facilitator: 100 base units USDC
  ($0.0001). Below that the SOL gas paid on the payer's behalf exceeds the
  value of the transfer.
- Sanitized error responses (no library-internal strings echoed to clients).
- `mode: 0o600` on CLI-written wallet files.
- Workflow permissions tightened to `contents: read`.

### Verified on-chain (Solana devnet)

- Smoke test (raw USDC transfer):
  [`2pRGWM6m...kipwL`](https://explorer.solana.com/tx/2pRGWM6miuKs5M1qC4ZDfWVdLCqyefsCfiSvqGbgYY15UsE4rmdMer4dZooPW8hajYGYhxAzyjB7DV8rKM9kipwL?cluster=devnet)
- First x402 settlement (own facilitator):
  [`EsqzTG8id...Bnku`](https://explorer.solana.com/tx/EsqzTG8id5CF5yxXmSSictkJnqn1uVC514joHqVBpdfSy4MkzvGzGGdb7Fybkn5ruSGyCQ87jyjmHuSGpU2Bnku?cluster=devnet)

## Notes

This project is pre-alpha. APIs may change between 0.0.x bumps without
deprecation notices. Once we tag `v0.1.0` we'll start following semver.

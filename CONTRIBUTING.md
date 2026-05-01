# Contributing to agenticpay

Thanks for your interest. This is a pre-alpha project; bug reports, fixes,
and ideas are all welcome.

## Repo layout

This is a `pnpm` workspace monorepo. Source lives under `packages/` and
`examples/`. You'll need:

- Node 20+
- `pnpm` 9+ (the project pins `packageManager: pnpm@9.0.0`)

Bootstrap:

```bash
pnpm install
pnpm -r build
pnpm -r typecheck
```

CI runs `pnpm -r typecheck` after `pnpm -r build` (CLI depends on SDK's
`dist/`, so build first).

## Reporting a bug

Open an issue at <https://github.com/krystiangw/agenticpay/issues>. Please
include:

- The package and version (`@agenticpay/...`)
- Network identifier (CAIP-2)
- A minimal repro — `examples/two-agent-demo/src/probe.ts` is a good
  template for direct facilitator probes

For **security issues**, do not open a public issue — see
[SECURITY.md](SECURITY.md) instead.

## Pull requests

1. Fork → branch (`feat/<short-name>`, `fix/<short-name>`, `docs/...`)
2. Make the change
3. Run `pnpm -r build && pnpm -r typecheck` — green required
4. Add or update tests if applicable
5. Update the relevant package's `README.md` if user-visible behavior changes
6. Open a PR. CI must pass.

Small PRs (one concern per PR) get reviewed faster. Big refactors get a
design issue first.

## Coding style

- Strict TypeScript (`noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`).
- `module: NodeNext`, ESM throughout.
- No comments that just restate what the code does. Comments explain *why*.
- Don't add error handling for cases that can't happen — trust framework guarantees and validate at boundaries only.

## Adding a new package

```bash
# scaffold from an existing one
cp -r packages/sdk packages/<your-pkg>
# edit package.json: name, description, dependencies
# add it to pnpm-workspace.yaml (it should already be picked up by `packages/*`)
```

Publishable packages must:

- Have `publishConfig.access: public`
- Set `repository.directory` to `packages/<your-pkg>`
- Include MIT license, keywords, homepage
- Restrict `files` to `["dist", "README.md"]`

## Conventions

- The existing on-chain `'agentpay rocks'` test string is preserved across
  README/landing/agent-llm.ts. Don't rename it — the on-chain TX hashes
  cited in docs were generated against that exact input.
- Hosted facilitator URL is `agentpay-facilitator-e9b20a5fee6a.herokuapp.com`
  and stays that way (the hostname is referenced in commit history). Do
  not "fix" it to agenticpay.

## Security policy

See [SECURITY.md](SECURITY.md) for vulnerability disclosure and key handling.

## License

By contributing you agree your contribution is MIT-licensed.

# Dockerfile for Glama AI safety/quality checks.
#
# Glama runs this image, sends an MCP `initialize` request over stdio, and
# expects a well-formed MCP response. The bridge never makes any real HTTP
# call during the handshake — paid endpoints are only hit at tool invocation
# time, which the smoke test does not exercise.
#
# Configuration is supplied at runtime via env vars; the placeholder values
# here are *only* for the safety check (random keypair, empty tool list).
# Real deployments override every var via Claude Desktop / Cursor config.

FROM node:20-alpine AS builder

# Tools needed for native rebuilds (sodium-style deps in @solana/*)
RUN apk add --no-cache python3 make g++

# Set up pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /repo

# Copy the entire workspace — pnpm needs the root + sibling packages so
# `workspace:*` deps resolve.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY examples/ ./examples/

# Install all workspace deps (production + dev), build everything. The
# bridge depends on `@agenticpay/sdk` via workspace:* which needs to be
# built first; pnpm -r build does this in topological order.
RUN pnpm install --frozen-lockfile=false
RUN pnpm -r build

# Final runtime image — a thin one with only the bridge + its prod deps.
FROM node:20-alpine AS runtime

WORKDIR /app

COPY --from=builder /repo/packages/mcp-bridge/package.json ./package.json
COPY --from=builder /repo/packages/mcp-bridge/dist ./dist
COPY --from=builder /repo/node_modules ./node_modules

# Default to a valid placeholder keypair + a single no-op tool so the
# Glama safety check can complete the MCP `initialize` / `tools/list`
# handshake without any external calls. The keypair is a real Solana
# Ed25519 pair (unfunded; never used to sign anything during the check).
# The placeholder tool registers the `tools` capability — without at least
# one tool the MCP SDK does not install a `tools/list` handler. Real
# configs override every var via Claude Desktop / Cursor config.
ENV AGENTICPAY_BRIDGE_KEYPAIR='[131,90,50,162,152,65,58,32,210,149,3,159,230,205,27,243,117,45,228,3,171,247,205,251,167,38,133,16,154,84,138,177,89,173,147,50,9,159,119,164,126,76,179,57,235,0,214,209,149,65,50,53,224,104,24,240,103,168,66,253,79,216,184,235]'
ENV AGENTICPAY_BRIDGE_TOOLS='[{"name":"agenticpay_info","description":"Placeholder tool for the Glama introspection handshake. Replace AGENTICPAY_BRIDGE_TOOLS with your real paid endpoints.","url":"http://127.0.0.1/agenticpay-placeholder","inputSchema":{}}]'
ENV AGENTICPAY_BRIDGE_NETWORK='solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
ENV AGENTICPAY_BRIDGE_RPC='https://api.devnet.solana.com'

ENTRYPOINT ["node", "dist/cli.js"]

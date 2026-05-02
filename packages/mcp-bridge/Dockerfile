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

# Default to a deterministic placeholder keypair + empty tool list so the
# Glama safety check can complete the MCP `initialize` / `tools/list`
# handshake without any external calls. Real configs override these.
ENV AGENTICPAY_BRIDGE_KEYPAIR='[59,21,116,167,74,162,179,87,200,49,246,74,1,109,17,233,131,29,244,28,160,16,95,189,177,93,60,170,225,152,7,29,135,148,247,232,12,63,234,112,151,199,71,5,194,126,80,228,210,34,161,227,176,206,229,36,12,109,119,233,30,3,248,90]'
ENV AGENTICPAY_BRIDGE_TOOLS='[]'
ENV AGENTICPAY_BRIDGE_NETWORK='solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
ENV AGENTICPAY_BRIDGE_RPC='https://api.devnet.solana.com'

ENTRYPOINT ["node", "dist/cli.js"]

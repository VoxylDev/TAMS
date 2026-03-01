# TAMS Server — Multi-stage Docker Build
#
# Builds the TypeScript monorepo and produces a minimal production image
# running the TAMS HTTP server on port 3100.
#
# Usage:
#   docker build -t tams-server .
#   docker run -p 3100:3100 --env-file .env tams-server

# --- Stage 1: Build ---

FROM node:22-alpine AS builder

WORKDIR /app

# Enable Corepack for Yarn Berry
RUN corepack enable

# Copy workspace config and lockfile first for layer caching
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn .yarn
COPY packages/common/package.json packages/common/
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/mcp/package.json packages/mcp/

RUN yarn install --immutable

# Copy source and build
COPY tsconfig.json eslint.config.js ./
COPY packages packages

RUN yarn build

# --- Stage 2: Production ---

FROM node:22-alpine

WORKDIR /app

RUN corepack enable

# Copy built artifacts and production dependencies
COPY --from=builder /app/package.json /app/yarn.lock /app/.yarnrc.yml ./
COPY --from=builder /app/.yarn .yarn
COPY --from=builder /app/packages/common/package.json packages/common/
COPY --from=builder /app/packages/common/dist packages/common/dist
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/server/dist packages/server/dist

RUN yarn workspaces focus @tams/server --production

EXPOSE 3100

CMD ["node", "--enable-source-maps", "packages/server/dist/main.js"]

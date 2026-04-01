# Session – Room Booking System
# Multi-stage build

# ---- Build stage ----
FROM node:20-alpine AS build

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./

# --ignore-scripts skips Prisma's postinstall download; we run generate explicitly below
# Retry npm install to reduce flaky build failures from transient registry/network issues.
RUN set -eux; \
    for i in 1 2 3 4 5; do \
      npm ci --ignore-scripts && break; \
      if [ "$i" -eq 5 ]; then \
        echo "npm ci failed after $i attempts"; \
        exit 1; \
      fi; \
      echo "npm ci failed (attempt $i), retrying..."; \
      sleep $((i * 5)); \
    done

COPY prisma ./prisma/

# Generate Prisma client with correct Alpine/OpenSSL 3 binary
RUN set -eux; \
    for i in 1 2 3 4 5; do \
      npx prisma generate && break; \
      if [ "$i" -eq 5 ]; then \
        echo "prisma generate failed after $i attempts"; \
        exit 1; \
      fi; \
      echo "prisma generate failed (attempt $i), retrying..."; \
      sleep $((i * 5)); \
    done

# Remove dev dependencies so runtime image stays lean
RUN npm prune --omit=dev --ignore-scripts

# ---- Runtime stage ----
FROM node:20-alpine AS runtime

RUN apk add --no-cache openssl && \
    addgroup -S session && adduser -S session -G session

WORKDIR /app

# Copy pruned production node_modules and generated Prisma client
COPY --from=build /app/node_modules ./node_modules

# Copy application source
COPY src ./src
COPY views ./views
COPY public ./public
COPY locales ./locales
COPY prisma ./prisma
COPY package.json ./

# Create writable directories and fix ownership
RUN mkdir -p logs config public/uploads \
    && chown -R session:session /app

USER session

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "src/server.js"]

# ---- Migrate stage (Debian-based – avoids Alpine/musl schema-engine issues) ----
FROM node:20-slim AS migrate

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends openssl ca-certificates libssl3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Force Prisma to use Debian/OpenSSL 3 engines in this stage.
ENV PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x
ENV PRISMA_SCHEMA_ENGINE_BINARY=/app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node

COPY package*.json ./
RUN set -eux; \
    for i in 1 2 3 4 5; do \
      npm ci --ignore-scripts && break; \
      if [ "$i" -eq 5 ]; then \
        echo "npm ci failed after $i attempts"; \
        exit 1; \
      fi; \
      echo "npm ci failed (attempt $i), retrying..."; \
      sleep $((i * 5)); \
    done

COPY prisma ./prisma/
RUN set -eux; \
    for i in 1 2 3 4 5; do \
      npx prisma generate && break; \
      if [ "$i" -eq 5 ]; then \
        echo "prisma generate failed after $i attempts"; \
        exit 1; \
      fi; \
      echo "prisma generate failed (attempt $i), retrying..."; \
      sleep $((i * 5)); \
    done

COPY src/db ./src/db
COPY prisma/seed.js ./prisma/seed.js

CMD ["sh", "-c", "npx prisma migrate deploy && node prisma/seed.js"]

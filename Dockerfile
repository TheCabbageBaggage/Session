# Session – Room Booking System
# Multi-stage build

# ---- Build stage ----
FROM node:20-alpine AS build

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./

# Install ALL deps (including devDependencies so prisma CLI is available)
# Increase fetch retries for flaky networks
RUN npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY prisma ./prisma/

# Generate Prisma client with correct Alpine/OpenSSL 3 binary
RUN npx prisma generate

# Remove dev dependencies so runtime image stays lean
RUN npm prune --omit=dev

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

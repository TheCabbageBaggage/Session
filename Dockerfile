# Session – Room Booking System
# Multi-stage build

# ---- Build stage ----
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma/
RUN npx prisma generate

# ---- Runtime stage ----
FROM node:20-alpine AS runtime

RUN addgroup -S session && adduser -S session -G session

WORKDIR /app

# Copy dependencies and generated Prisma client
COPY --from=build /app/node_modules ./node_modules

# Copy application source
COPY src ./src
COPY views ./views
COPY public ./public
COPY locales ./locales
COPY prisma ./prisma
COPY package.json ./

# Create directories
RUN mkdir -p logs config public/uploads \
    && chown -R session:session /app

USER session

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "src/server.js"]

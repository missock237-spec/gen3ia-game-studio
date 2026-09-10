# GEN3IA GAME STUDIO — image app Next.js (web + API) pour docker compose.
# Multi-stage : deps → build → runner standalone.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY prisma ./prisma
RUN npm install --no-audit --no-fund && npx prisma generate

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S gen3ia && adduser -S gen3ia -G gen3ia
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/db ./db
USER gen3ia
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health > /dev/null 2>&1 || exit 1
# SIGTERM → arrêt propre des connexions en cours
STOPSIGNAL SIGTERM
CMD ["node", "server.js"]

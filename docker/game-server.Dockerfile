# Serveur multijoueur GEN3IA — image de production.
FROM oven/bun:1-alpine AS base
WORKDIR /app

COPY mini-services/game-server/package.json ./
COPY mini-services/game-server/index.ts ./

ENV NODE_ENV=production
EXPOSE 3003 3103

CMD ["bun", "index.ts"]

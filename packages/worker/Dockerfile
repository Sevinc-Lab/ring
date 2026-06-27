# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Toolchain for compiling better-sqlite3's native binding.
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app

# ffmpeg is needed for M2 recording/thumbnails; harmless to include now.
RUN apk add --no-cache ffmpeg

ENV NODE_ENV=production

COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Drop dev dependencies (typescript, tsx) but keep the compiled native binding.
RUN npm prune --omit=dev --no-audit --no-fund

# Health: heartbeat file must be fresher than 3 minutes (worker writes every 60s).
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const f=process.env.HEARTBEAT_FILE||'/data/db/.heartbeat';const{statSync}=require('fs');try{process.exit(Date.now()-statSync(f).mtimeMs<180000?0:1)}catch(e){process.exit(1)}"

CMD ["node", "dist/index.js"]

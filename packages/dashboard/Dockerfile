# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Toolchain for compiling better-sqlite3's native binding.
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json next.config.mjs next-env.d.ts ./
COPY src ./src
RUN npm run build
# Drop dev dependencies; keep next + react + better-sqlite3 (with its native binary).
RUN npm prune --omit=dev --no-audit --no-fund

# ---- runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json next.config.mjs next-env.d.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next

EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]

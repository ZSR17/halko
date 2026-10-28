# Halko: one image serving the API and the built web app, for linux/amd64, linux/arm64 and linux/arm/v7:
#   docker build -t halko:latest .

# 1. Build the client (web app). The same files for every platform: built once, on the machine building.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS client
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY client/ client/
RUN npm run build -w client

# 2. Server production dependencies (native modules: better-sqlite3, sharp).
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev -w server -w shared

# 3. Runtime: Node + ffmpeg (video and GIF conversion).
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
# The licence and its notice go with every copy of Halko, this image included.
COPY package.json LICENSE NOTICE ./
COPY shared/ shared/
COPY server/package.json server/
COPY server/src server/src
COPY server/drizzle server/drizzle
COPY --from=client /app/client/dist client/dist

COPY docker/entrypoint.sh /usr/local/bin/halko-entrypoint
RUN chmod 755 /usr/local/bin/halko-entrypoint

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    STATIC_DIR=/app/client/dist
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/server
# Started as root only to give data/ to PUID:PGID, then run as them (see docker/entrypoint.sh).
ENTRYPOINT ["halko-entrypoint"]
CMD ["node", "--import", "tsx", "src/main.ts"]

# One image: the Fastify API + the built web app on one port.
# Build:  docker build -t junction-lab .
# Run:    docker run -p 7860:7860 junction-lab   → http://localhost:7860

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY engine/package.json engine/
COPY server/package.json server/
COPY web/package.json web/
# --ignore-scripts: better-sqlite3 ships prebuilt binaries; without it npm tries to compile
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY tsconfig.base.json ./
COPY networks networks
COPY engine engine
COPY server server
COPY web web
RUN npm run build -w web && npm run build -w server

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=7860 \
    STATIC_DIR=/app/web \
    DB_PATH=/tmp/traffic.db \
    TRUST_PROXY=1
WORKDIR /app
# better-sqlite3 ships prebuilt binaries in its package; it is the only runtime dependency
# left outside the esbuild bundle.
COPY --from=build /app/node_modules/better-sqlite3 node_modules/better-sqlite3
COPY --from=build /app/server/dist server
COPY --from=build /app/web/dist web
# Hugging Face Spaces runs containers as uid 1000 (the image's "node" user)
USER node
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.js"]

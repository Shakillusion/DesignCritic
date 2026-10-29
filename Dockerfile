# DesignCritic AI — production image (amd64 or arm64, e.g. Oracle Ampere A1).
# Chromium renders, exports and QA-checks designs; SQLite + uploads live in /data.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-core fonts-noto-color-emoji ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DESIGNCRITIC_DATA_DIR=/data \
    DESIGNCRITIC_BROWSER_PATH=/usr/bin/chromium \
    DESIGNCRITIC_BROWSER_NO_SANDBOX=1

RUN mkdir -p /data && chown -R node:node /data /app/.next
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["npm", "start"]

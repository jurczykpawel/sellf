# Build from the repository root. No app configuration or secrets enter this image.
FROM oven/bun:1.3.14-slim AS bun
FROM node:22-bookworm-slim
COPY --from=bun /usr/local/bin/bun /root/.bun/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates python3 openssl util-linux && rm -rf /var/lib/apt/lists/*
ENV HOME=/root PM2_HOME=/root/.pm2
RUN /root/.bun/bin/bun install -g pm2
COPY admin-panel/scripts/upgrade.sh /opt/sellf/admin-panel/scripts/upgrade.sh

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates python3 openssl util-linux jq && rm -rf /var/lib/apt/lists/*
RUN npm install -g pm2@6.0.14
ENV HOME=/root PM2_HOME=/root/.pm2

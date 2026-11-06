FROM node:22-bookworm-slim
ENV NODE_ENV=production NODE_NO_WARNINGS=1 NODE_OPTIONS=--max-old-space-size=480 HOST=0.0.0.0 PORT=8083 DATA_DIR=/data
WORKDIR /app
# No npm install: the app has zero runtime dependencies.
COPY package.json ./
COPY config ./config
COPY public ./public
COPY scripts ./scripts
COPY server ./server
# Build-time check that every configured model exists on OpenRouter and supports tools.
# Skip with --build-arg SKIP_MODEL_CHECK=1 if the build host has no outbound network.
ARG SKIP_MODEL_CHECK=0
RUN if [ "$SKIP_MODEL_CHECK" != "1" ]; then node scripts/validate-models.mjs; fi
RUN mkdir -p /data && chown node:node /data
USER node
HEALTHCHECK --interval=30s --timeout=4s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8083/theoffice/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
EXPOSE 8083
CMD ["node", "server/index.js"]

FROM node:22-alpine

WORKDIR /app
COPY server ./server
COPY pwa/platform/metadata/stores.js ./pwa/platform/metadata/stores.js

ENV PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]

# --- Build: Frontend bauen ---
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

# --- Laufzeit: nur Server-Abhängigkeiten, Node führt die .ts-Quellen direkt aus ---
FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8470 \
    DATA_DIR=/data \
    WEB_DIR=/app/public
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY server/src server/src
COPY --from=build /app/web/build public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8470
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/src/main.ts"]

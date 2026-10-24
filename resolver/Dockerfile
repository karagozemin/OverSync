FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
ARG OCI_SOURCE="https://github.com/karagozemin/OverSync"
ARG OCI_REVISION="unknown"
ARG OCI_VERSION="0.1.0"
ARG OCI_LICENSES="MIT"
LABEL org.opencontainers.image.title="oversync-resolver" \
      org.opencontainers.image.description="Reference resolver implementation for the OverSync cross-chain bridge" \
      org.opencontainers.image.source="${OCI_SOURCE}" \
      org.opencontainers.image.revision="${OCI_REVISION}" \
      org.opencontainers.image.version="${OCI_VERSION}" \
      org.opencontainers.image.licenses="${OCI_LICENSES}"
WORKDIR /app
RUN corepack enable
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
USER node
ENV NODE_ENV=production
ENTRYPOINT ["node", "dist/index.js"]
CMD ["run"]

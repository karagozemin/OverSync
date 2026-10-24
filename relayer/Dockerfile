FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ARG OCI_SOURCE="https://github.com/karagozemin/OverSync"
ARG OCI_REVISION="unknown"
ARG OCI_VERSION="1.0.0"
ARG OCI_LICENSES="MIT"
LABEL org.opencontainers.image.title="oversync-relayer" \
      org.opencontainers.image.description="Event relayer service for the OverSync cross-chain bridge" \
      org.opencontainers.image.source="${OCI_SOURCE}" \
      org.opencontainers.image.revision="${OCI_REVISION}" \
      org.opencontainers.image.version="${OCI_VERSION}" \
      org.opencontainers.image.licenses="${OCI_LICENSES}"

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 8080

CMD ["npm", "start"]

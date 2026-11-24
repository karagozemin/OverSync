FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY resolver/package.json resolver/package.json
COPY packages/sdk/package.json packages/sdk/package.json
RUN pnpm install --frozen-lockfile --filter @oversync/resolver...
COPY resolver/ resolver/
COPY packages/sdk/ packages/sdk/
RUN pnpm --filter @oversync/sdk build && pnpm --filter @oversync/resolver build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY resolver/package.json resolver/package.json
COPY packages/sdk/package.json packages/sdk/package.json
RUN pnpm install --prod --frozen-lockfile --filter @oversync/resolver...
COPY --from=builder /app/resolver/dist resolver/dist
COPY --from=builder /app/packages/sdk/dist packages/sdk/dist
# Standard OCI labels (issue #400). Declared after the last RUN so a new
# revision does not invalidate cached layers. CI overrides the defaults with
# --build-arg; enforced by scripts/lib/dockerfile-oci-labels.mjs.
ARG OCI_SOURCE=https://github.com/karagozemin/OverSync
ARG OCI_REVISION=unknown
ARG OCI_VERSION=dev
LABEL org.opencontainers.image.source="${OCI_SOURCE}" \
      org.opencontainers.image.revision="${OCI_REVISION}" \
      org.opencontainers.image.version="${OCI_VERSION}" \
      org.opencontainers.image.licenses="MIT"
USER node
ENV NODE_ENV=production
WORKDIR /app/resolver
ENTRYPOINT ["node", "dist/index.js"]
CMD ["run"]

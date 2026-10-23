FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

# Run as the image's built-in unprivileged `node` user (uid 1000). The final
# build stage must end non-root — enforced by scripts/lib/dockerfile-users.mjs.
USER node

EXPOSE 8080

CMD ["npm", "start"]

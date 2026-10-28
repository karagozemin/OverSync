FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HEALTHCHECK_PATH=/health
ENV HEALTHCHECK_INTERVAL=30s
ENV HEALTHCHECK_TIMEOUT=5s
ENV HEALTHCHECK_RETRIES=3
ENV HEALTHCHECK_START_PERIOD=10s

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

# Run as the image's built-in unprivileged `node` user (uid 1000). The final
# build stage must end non-root — enforced by scripts/lib/dockerfile-users.mjs.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const p=process.env.PORT||8080,path=process.env.HEALTHCHECK_PATH||'/health';const r=require('http').get({host:'127.0.0.1',port:p,path,timeout:4000},res=>process.exit(res.statusCode>=200&&res.statusCode<300?0:1));r.on('timeout',()=>{r.destroy();process.exit(1)});r.on('error',()=>process.exit(1));"]

CMD ["npm", "start"]

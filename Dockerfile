# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --include=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    WEBHOOK_PORT=3000

RUN apk add --no-cache tini \
    && addgroup -S app && adduser -S app -G app \
    && mkdir -p /app/data && chown -R app:app /app

COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package.json package-lock.json tsconfig.json ./
COPY --chown=app:app src ./src
COPY --chown=app:app scripts ./scripts

USER app

VOLUME ["/app/data"]
WORKDIR /app/data

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--import", "tsx", "/app/src/bot.ts"]

# Production image: builds the web app and runs the API (which also serves the web files and the
# collaboration WebSocket) as one process on one port. Used by docker-compose.prod.yml and by
# container hosts such as Railway, Render or Fly.io.
FROM node:22-alpine AS build
RUN npm install -g pnpm@10 --no-fund --no-audit
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @writers-room/web build

FROM node:22-alpine
RUN npm install -g pnpm@10 --no-fund --no-audit && apk add --no-cache postgresql16-client
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
ENV WEB_DIST=/app/apps/web/dist
ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["pnpm", "--filter", "@writers-room/server", "start"]

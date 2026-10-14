# The job server with plain-HTTP fetching. Browser fetching needs the Browser Use Extension on
# the host: mount its data folder and set BROWSER_USE_EXTENSION_HOME to reach its bridge.
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY vendor ./vendor
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod
ENV BROWSER_CRAWL_HOME=/data
VOLUME /data
EXPOSE 8787
CMD ["node", "dist/cli.js", "serve", "--host", "0.0.0.0", "--port", "8787"]

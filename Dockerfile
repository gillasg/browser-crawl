# The job server with plain-HTTP fetching. Browser fetching needs the Browser Use Extension on
# the host: mount its data folder and set BROWSER_USE_EXTENSION_HOME to reach its bridge.
#
# browser-crawl links to site-to-api and pi-ai-login in sibling folders, so build from the folder
# that holds all three (after `node scripts/link-repos.mjs`):
#   docker build -f browser-crawl/Dockerfile -t browser-crawl ..
FROM node:22-slim
WORKDIR /repos
RUN corepack enable
COPY pi-ai-login/package.json pi-ai-login/pnpm-lock.yaml pi-ai-login/pnpm-workspace.yaml pi-ai-login/tsconfig.json pi-ai-login/
COPY pi-ai-login/src pi-ai-login/src
COPY pi-ai-login/ui pi-ai-login/ui
COPY pi-ai-login/scripts pi-ai-login/scripts
RUN cd pi-ai-login && pnpm install --frozen-lockfile && pnpm build
COPY site-to-api/package.json site-to-api/pnpm-lock.yaml site-to-api/pnpm-workspace.yaml site-to-api/tsconfig.json site-to-api/
COPY site-to-api/src site-to-api/src
RUN cd site-to-api && pnpm install --frozen-lockfile && pnpm build
COPY browser-crawl/package.json browser-crawl/pnpm-lock.yaml browser-crawl/pnpm-workspace.yaml browser-crawl/tsconfig.json browser-crawl/
COPY browser-crawl/src browser-crawl/src
RUN cd browser-crawl && pnpm install --frozen-lockfile && pnpm build
WORKDIR /repos/browser-crawl
ENV BROWSER_CRAWL_HOME=/data
VOLUME /data
EXPOSE 8787
CMD ["node", "dist/cli.js", "serve", "--host", "0.0.0.0", "--port", "8787"]

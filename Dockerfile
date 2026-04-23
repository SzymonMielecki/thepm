# Build: docker build -t always-on-pm .
# Run:  docker run -p 3000:3000 -v pmdata:/data \
#   -e HUB_TOKEN=secret -e CODE_BACKEND=bridge \
#   -e ANTHROPIC_API_KEY=... -e ELEVENLABS_API_KEY=... always-on-pm
#
# Point `pnpm thepm-bridge` (on your laptop) at https://<host>:3000 with the same HUB_TOKEN.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NODE_ENV=production
RUN pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apt-get update && apt-get install -y --no-install-recommends ripgrep \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
RUN cd /app && pnpm install --frozen-lockfile --prod
EXPOSE 3000
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATABASE_PATH=/data/app.db
VOLUME ["/data"]
CMD ["node", "--import", "tsx", "server.ts"]

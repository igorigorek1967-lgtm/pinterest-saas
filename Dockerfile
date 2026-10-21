FROM node:24.19.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24.19.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 RESEARCH_DATA_DIR=/app/var/research
RUN groupadd --gid 1001 research && useradd --uid 1001 --gid research research && mkdir -p /app/var/research && chown -R research:research /app
COPY --from=build --chown=research:research /app/.next/standalone ./
COPY --from=build --chown=research:research /app/.next/static ./.next/static
COPY --from=build --chown=research:research /app/public ./public
USER research
EXPOSE 3000
CMD ["node", "server.js"]

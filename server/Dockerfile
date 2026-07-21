# Drippy ingest — production image. Build context is this server/ folder.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Install deps against the lockfile first, so layer caching survives code edits.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Fly maps its proxy to this internal port (see fly.toml). DATABASE_URL,
# ENROLL_TOKEN and PORT arrive as env/secrets at runtime, never baked in.
EXPOSE 8787
CMD ["node", "ingest.js"]

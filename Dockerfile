# syntax=docker/dockerfile:1

# --- Stage 1: build (install all deps + generate Prisma Client) ---------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install dependencies from the committed lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci

# Prisma schema + migrations, then generate the client (engine matches this
# Debian base image, which is reused by the runtime stage below).
COPY prisma ./prisma
RUN npx prisma generate

# --- Stage 2: runtime ---------------------------------------------------------
FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production

# Prisma's query engine needs OpenSSL on the slim Debian base.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Reuse the fully-installed node_modules from the builder. This intentionally
# retains the Prisma CLI (a devDependency) so `prisma migrate deploy` can run at
# container start; the generated client + query engine come along with it.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

# Application source, Prisma schema/migrations, and the startup script.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node src ./src
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh

# Run as the built-in non-root user.
USER node

EXPOSE 5000

# The entrypoint applies migrations (migrate deploy) then starts the server.
ENTRYPOINT ["./docker-entrypoint.sh"]

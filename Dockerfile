# SMKBBSP VisitorPass - application image
#
# Deliberately simple over small. This is a school deployment that has to be
# maintainable by whoever inherits it, so the runtime keeps a full node_modules
# (including the Prisma CLI) rather than using Next.js standalone output. That
# means migrations, seeding and one-off scripts can all be run inside the same
# image with the ordinary npm commands, instead of needing a second toolchain.

FROM node:22-alpine AS base
# openssl is required by Prisma's query engine; libc6-compat covers glibc-built
# native modules on Alpine.
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM base AS build

COPY package.json package-lock.json ./
COPY prisma ./prisma
# `npm install`, not `npm ci`, on purpose.
#
# The committed lockfile is generated on Windows, so it does not contain the
# Linux/musl variants of sharp's platform-specific optional dependencies (the
# @emnapi/* packages). `npm ci` demands an exact lockfile match and fails on
# those alone. `npm install` resolves the correct set for this platform while
# still honouring the pinned ranges in package.json.
#
# --ignore-scripts blocks the postinstall; generate is run explicitly below so
# the step is visible in the build log.
RUN npm install --ignore-scripts --no-audit --no-fund
RUN npx prisma generate

COPY . .

# `next build` imports modules that validate the environment at load time. These
# values are placeholders that satisfy that validation only; every one of them
# is replaced at runtime from the compose environment. No real secret is ever
# baked into the image.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
    APP_URL="http://localhost:3000" \
    SESSION_SECRET="YnVpbGQtb25seS1wbGFjZWhvbGRlci0zMi1ieXRlcyE=" \
    IDENTITY_ENCRYPTION_KEY="YnVpbGQtb25seS1lbmNyeXB0aW9uLXBsYWNlaG9sZDE=" \
    IDENTITY_HMAC_KEY="YnVpbGQtb25seS1obWFjLWtleS1wbGFjZWhvbGRlcjE=" \
    NODE_ENV="production"

RUN npm run build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
# The one-off scripts import domain modules through the "@/" alias, so lib has
# to be present for `npm run map:sync` to resolve them at deploy time.
COPY --from=build /app/lib ./lib
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json

# Run as the image's unprivileged user rather than root.
USER node

EXPOSE 3000

# Fails the container if the app stops serving, so compose can restart it.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]

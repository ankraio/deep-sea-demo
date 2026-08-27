# Zero runtime dependencies: the image is the Node runtime plus the app files.
FROM node:22-alpine

# The upstream node:*-alpine images are rebuilt less often than Alpine ships
# security fixes, so pull any published package updates at build time. Without
# this the image lands with whatever OpenSSL the base was baked against.
#
# The app never runs npm at runtime, so drop npm, corepack and yarn from the
# image too: fewer binaries, and none of npm's bundled dependencies to patch.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn*

ENV NODE_ENV=production
WORKDIR /app

COPY package.json server.js ./
COPY public ./public

# 1000 is the uid of the bundled non-root "node" user.
USER 1000:1000
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["wget", "-qO-", "http://127.0.0.1:8080/healthz"]

CMD ["node", "server.js"]

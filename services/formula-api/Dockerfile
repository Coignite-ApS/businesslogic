# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=npm_token \
    echo "//registry.npmjs.org/:_authToken=$(cat /run/secrets/npm_token)" > .npmrc && \
    npm ci --omit=dev && \
    rm -f .npmrc

# Production stage
FROM node:22-alpine
WORKDIR /app

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

USER appuser

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Tune Node.js for performance
CMD ["node", "--max-old-space-size=512", "--max-semi-space-size=64", "src/server.js"]

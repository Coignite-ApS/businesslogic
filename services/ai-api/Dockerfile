# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

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
ENV PORT=3200
EXPOSE 3200

# Higher memory for LLM streaming + embedding batches
CMD ["node", "--max-old-space-size=512", "--max-semi-space-size=64", "src/server.js"]

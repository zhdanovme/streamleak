FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++ gcc

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Production image
FROM node:20-alpine

# Install runtime dependencies for better-sqlite3 and duckdb
RUN apk add --no-cache python3 make g++ gcc

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Create data directories
RUN mkdir -p /data /data/errors

# Set environment variables
ENV NODE_ENV=production
ENV WATCH_PATH=/data
ENV ERROR_DIRECTORY=/data/errors
ENV PROGRESS_DB_PATH=/app/progress.db

# Run as non-root user
RUN addgroup -g 1000 appuser && \
    adduser -D -u 1000 -G appuser appuser && \
    chown -R appuser:appuser /app /data

USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD test -f /app/progress.db || exit 1

CMD ["node", "dist/index.js"]

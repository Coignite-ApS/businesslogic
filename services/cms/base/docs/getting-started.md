# Getting Started

First-time setup for Coignite Cockpit Directus development.

## Prerequisites

- **Docker** and **Docker Compose** (v2+)
- **Node.js** v22+ (for extension development)
- **NPM_TOKEN** for private @coignite packages
- **PostgreSQL client** (optional, for database sync): `brew install postgresql@16`

## Setup

### 1. Clone Repository

```bash
git clone https://github.com/Coignite-ApS/coignite-cockpit-directus.git
cd coignite-cockpit-directus
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your NPM_TOKEN (get from npm account or team lead):

```bash
NPM_TOKEN=your_npm_token_here
```

### 3. Start Development Environment

```bash
./dev.sh
```

This builds the Docker image, starts all services, and shows logs.

### 4. Access Services

| Service | URL | Credentials |
|---------|-----|-------------|
| Directus | http://localhost:8056 | `admin@example.com` / `admin123` |
| MailDev | http://localhost:1080 | - |

## Optional: Database Sync

To work with real data from dev/live environments:

```bash
# Set up credentials
cp .db-credentials.example .db-credentials
# Edit with your database connection details

# Sync from dev
./scripts/db-sync.sh dev --sanitize
```

See [Database Sync](database-sync.md) for details.

## Verify Setup

```bash
# Check services are running
docker compose ps

# Check Directus health
curl http://localhost:8056/server/health
```

## Next Steps

- [Local Development](local-development.md) - Daily development workflow
- [Extensions](extensions.md) - Creating and managing extensions
- [Database Sync](database-sync.md) - Import data from dev/live

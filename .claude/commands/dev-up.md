# Start Development Environment

Start the full Docker Compose development stack and verify health.

## Steps

1. Verify `.env` file exists: `ls infrastructure/docker/.env`
   - If missing: `cp infrastructure/docker/.env.example infrastructure/docker/.env`
   - Warn user to fill in secrets

2. Validate Docker Compose: `docker compose -f infrastructure/docker/docker-compose.dev.yml config`

3. Start all services: `docker compose -f infrastructure/docker/docker-compose.dev.yml up -d`

4. Wait for services to initialize (poll until ready, max 90 seconds):
   ```bash
   for i in {1..18}; do
     if curl -s http://localhost:8055/server/ping > /dev/null 2>&1; then break; fi
     sleep 5
   done
   ```

5. Run health check: `./scripts/health-check.sh`

6. Report which services are healthy and which need attention

7. If `--legacy` flag is passed, also start legacy services:
   `docker compose -f infrastructure/docker/docker-compose.dev.yml --profile legacy up -d`

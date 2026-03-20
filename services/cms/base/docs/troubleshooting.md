# Troubleshooting

Common issues and solutions.

## Quick Fixes

| Problem | Solution |
|---------|----------|
| Schema cache lock | `./scripts/reset-cache.sh local` |
| Extension not loading | `docker compose up -d --build directus` |
| Database issues | `docker compose down -v && ./dev.sh` |
| Port conflict | `lsof -i :8056` then kill process |

## Quick Diagnostics

### Check Service Status

```bash
# Local development
docker compose ps

# Service health
curl http://localhost:8056/server/health
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f directus
docker compose logs -f postgres
docker compose logs -f redis
```

## Common Issues

### Schema Cache Lock ("schemaCache--preparing")

**Symptoms:**
- Directus hangs on startup
- Logs show waiting for schema cache lock
- Service never becomes healthy

**Solution:**

```bash
# Local development
./scripts/reset-cache.sh local

# Production (SSH into container or use console)
./scripts/reset-cache.sh prod
```

Or manually:

```bash
# Local
docker compose exec redis redis-cli DEL "directus:lock:schemaCache--preparing"
docker compose restart directus

# Production
redis-cli -u "$REDIS" --tls DEL "directus:lock:schemaCache--preparing"
```

### Container Won't Start

**Symptoms:**
- Container exits immediately
- Health check fails repeatedly

**Diagnosis:**

```bash
# Check logs
docker compose logs directus

# Check if image built correctly
docker compose build directus --no-cache
```

**Common Causes:**

1. **Missing environment variables**
   - Check `.env` file exists
   - Verify NPM_TOKEN is set

2. **Port conflict**
   ```bash
   lsof -i :8056
   # Kill conflicting process or change port
   ```

3. **Database connection**
   ```bash
   docker compose logs postgres
   # Ensure postgres is healthy before directus starts
   ```

### Extension Not Loading

**Symptoms:**
- Extension not appearing in admin
- No errors in logs
- Functionality missing

**Diagnosis:**

```bash
# Check if extension is installed
docker compose exec directus ls /directus/extensions/

# Check for NPM extensions
docker compose exec directus ls /directus/extensions/node_modules/@coignite/

# Check logs for extension loading
docker compose logs directus | grep -i extension
```

**Solutions:**

1. **Rebuild container**
   ```bash
   docker compose up -d --build directus
   ```

2. **Verify extension is built (local)**
   ```bash
   ls extensions/local/my-extension/dist/
   # Should contain index.js
   ```

3. **Check package.json**
   - Verify extension is listed in `extensions/package.json`

4. **Check Directus version compatibility**
   - Some extensions require specific Directus versions

### NPM Install Fails

**Symptoms:**
- Docker build fails at npm install
- "401 Unauthorized" or "404 Not Found" errors

**Solutions:**

1. **Check NPM_TOKEN**
   ```bash
   # Verify token is in .env
   grep NPM_TOKEN .env

   # Verify token works
   npm whoami --registry https://registry.npmjs.org/
   ```

2. **Token permissions**
   - Token must have read access to @coignite packages
   - Contact team lead for new token if needed

3. **Clear npm cache**
   ```bash
   docker compose build --no-cache directus
   ```

### Database Connection Issues

**Symptoms:**
- "Connection refused" errors
- Database not ready

**Solutions:**

1. **Wait for postgres**
   ```bash
   # Check postgres health
   docker compose ps postgres

   # View postgres logs
   docker compose logs postgres
   ```

2. **Reset database**
   ```bash
   docker compose down -v
   ./dev.sh
   ```

3. **Check connection string**
   - Verify database URL in config file

### Redis Connection Issues

**Symptoms:**
- Cache not working
- Rate limiting errors
- Websocket issues

**Solutions:**

1. **Check Redis status**
   ```bash
   docker compose exec redis redis-cli ping
   # Should return: PONG
   ```

2. **View Redis data**
   ```bash
   docker compose exec redis redis-cli KEYS "*"
   ```

3. **Clear Redis**
   ```bash
   docker compose exec redis redis-cli FLUSHALL
   docker compose restart directus
   ```

### Email Not Working

**Symptoms:**
- Password reset emails not sent
- Email triggers fail silently

**Local Development:**

1. Check MailDev at http://localhost:1080
2. All emails should appear there

**Production:**

1. Verify Mailgun credentials
2. Check Mailgun dashboard for delivery status
3. Review Directus logs for email errors

### Hot Reload Not Working

**Symptoms:**
- Changes to local extensions not reflected
- Need to restart container for changes

**Solutions:**

1. **Verify auto-reload is enabled**
   ```yaml
   # config.local.yaml
   EXTENSIONS_AUTO_RELOAD: true
   ```

2. **Check file watching**
   ```bash
   # Run extension in dev mode
   cd extensions/local/my-extension
   npm run dev
   ```

3. **Restart container**
   ```bash
   docker compose restart directus
   ```

### Permission Errors

**Symptoms:**
- "EACCES" or "permission denied" errors
- File operation failures

**Solutions:**

1. **Fix file ownership**
   ```bash
   sudo chown -R $(whoami) extensions/
   ```

2. **Docker volume permissions**
   ```bash
   docker compose down -v
   ./dev.sh
   ```

## Production Issues

### Deployment Fails

**Check:**
1. GitHub Actions logs for build errors
2. App Platform deployment logs
3. Environment variables are set

**Common Fixes:**
- Verify NPM_TOKEN secret in GitHub
- Check DIGITALOCEAN_ACCESS_TOKEN permissions
- Review Dockerfile for syntax errors

### High Memory Usage

**Symptoms:**
- Container restarts
- OOM (Out of Memory) errors
- Memory % gradually increasing over time

**Diagnosis:**

```bash
# Check current memory stats
curl http://localhost:8056/memory-stats/

# Get Prometheus-compatible metrics
curl http://localhost:8056/memory-stats/metrics

# Health check (returns 503 if thresholds exceeded)
curl http://localhost:8056/memory-stats/health
```

**Solutions:**

1. **Enable memory monitoring** - See [Monitoring Guide](monitoring.md)

2. **Enable auto-restart** (temporary fix)
   ```yaml
   # config.live.yaml
   MEMORY_STATS_RESTART_ON_RAM: '85'
   ```

3. **Increase container memory**
   - App Platform: Increase instance size
   - Local: Increase Docker memory allocation

4. **Review extensions**
   - Disable extensions one by one to identify memory leaks
   - Check Sentry for correlations between errors and high memory

### Slow Performance

**Diagnosis:**

```bash
# Check response times
curl -w "@curl-format.txt" http://localhost:8056/server/health
```

**Common Causes:**

1. **Cache misconfiguration**
   - Verify Redis is connected
   - Check CACHE_ENABLED is true

2. **Database indexes**
   - Review slow query logs
   - Add indexes for frequent queries

3. **Extension issues**
   - Disable extensions one by one to identify culprit

## Logs and Debugging

### Enable Debug Logging

```yaml
# config.local.yaml
LOG_LEVEL: debug
```

### Useful Log Filters

```bash
# Extension loading
docker compose logs directus | grep -i "extension"

# Database queries
docker compose logs directus | grep -i "query"

# Errors only
docker compose logs directus | grep -E "error|Error|ERROR"

# Specific extension
docker compose logs directus | grep -i "sentry"
```

### Health Check Details

```bash
# Full health info
curl http://localhost:8056/server/health | jq

# Server info (requires auth)
curl -H "Authorization: Bearer <token>" http://localhost:8056/server/info | jq
```

## Reset Everything

Nuclear option - start completely fresh:

```bash
# Stop everything and remove volumes
docker compose down -v

# Remove Docker build cache
docker builder prune -f

# Clean npm cache in extensions
rm -rf extensions/node_modules
rm -rf extensions/local/*/node_modules
rm -rf extensions/local/*/dist

# Start fresh
./dev.sh
```

## Getting Help

### Information to Gather

When reporting issues, include:

1. **Directus version** - From Dockerfile
2. **Extension versions** - From extensions/package.json
3. **Error logs** - Relevant log output
4. **Steps to reproduce** - What you did
5. **Environment** - Local/dev/production

### Resources

- Directus Documentation: https://docs.directus.io
- Directus GitHub Issues: https://github.com/directus/directus/issues
- @coignite extension issues: Contact team

## See Also

- [Local Development](local-development.md) - Development workflow
- [Deployment](deployment.md) - CI/CD and App Platform
- [Extensions](extensions.md) - Extension management
- [Monitoring](monitoring.md) - Memory/CPU monitoring and auto-restart

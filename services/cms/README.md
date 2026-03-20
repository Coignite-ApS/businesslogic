# Directus Project Template

Template for creating new Directus projects with shared infrastructure.

## Using This Template

```bash
# Clone template
git clone --recurse-submodules git@github.com:Coignite-ApS/coignite-directus-template.git my-project
cd my-project

# Initialize project (replaces placeholders)
./init-project.sh

# Setup and run
cp .env.example .env  # Add NPM_TOKEN
make init && make dev
```

The `init-project.sh` script will prompt for:
- **Project Name** - Human readable (e.g., "Acme Dashboard")
- **Project Slug** - URL-safe (e.g., "acme-dashboard")
- **Repo Name** - GitHub repo (e.g., "acme-dashboard-directus")
- **Description** - One-line description
- **Sentry DSN** - Optional, can add later

After initialization, update remote and push:
```bash
git remote set-url origin git@github.com:Coignite-ApS/YOUR-REPO.git
git push -u origin main
```

---

# Businesslogic CMS Directus

Businesslogic Administration of Excel Calculators

[![Build](https://github.com/Coignite-ApS/businesslogic-cms/actions/workflows/build-and-deploy.yml/badge.svg)](https://github.com/Coignite-ApS/businesslogic-cms/actions/workflows/build-and-deploy.yml)

## Tech Stack

| Component | Technology |
|-----------|------------|
| CMS | Directus 11.9.3 |
| Runtime | Node.js 22 |
| Database | PostgreSQL 16 + PostGIS |
| Cache | Redis 7 |
| Monitoring | Sentry |

## Quick Start

```bash
git clone --recurse-submodules git@github.com:Coignite-ApS/businesslogic-cms.git
cd businesslogic-cms
cp .env.example .env  # Add NPM_TOKEN
make init && make dev
```

**Access:** http://localhost:8055 (admin@example.com / admin123)

## Project Structure

```
businesslogic-cms/
├── base/                    # Git submodule (coignite-directus-base)
├── extensions/              # Project-specific extensions
│   ├── package.json         # NPM extensions
│   └── local/               # Local extensions
├── config.*.yaml            # Environment configs
├── Makefile                 # Commands
├── docker-compose.yml
├── email-templates/
└── snapshots/
```

## Commands

| Command | Description |
|---------|-------------|
| `make init` | Initialize submodule + build extensions |
| `make dev` | Start development environment |
| `make stop` | Stop services |
| `make clean` | Stop + remove volumes |
| `make update` | Update base submodule |
| `make check-updates` | Check Directus/extension updates |
| `make db-sync` | Sync database from remote |

## Documentation

See [base/docs/](base/docs/) for detailed documentation.

## License

Private - Coignite ApS

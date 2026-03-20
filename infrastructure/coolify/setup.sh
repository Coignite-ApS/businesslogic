#!/bin/bash
# =============================================================================
# Coolify Setup Script
# =============================================================================
# Installs Coolify on S1 (gateway) and adds other servers as agents.
# Run on S1 after Terraform provisioning.
#
# Prerequisites:
#   - SSH access to all 5 servers
#   - Terraform outputs available
# =============================================================================

set -euo pipefail

echo "BusinessLogic — Coolify Setup"
echo "=============================="

# Step 1: Install Coolify on S1 (gateway)
echo ""
echo "Step 1: Installing Coolify on S1 (gateway)..."
echo "Run on S1:"
echo "  curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash"
echo ""
echo "After install, access Coolify at: http://<S1-IP>:8000"
echo ""

# Step 2: Add servers as Coolify agents
echo "Step 2: Add servers as agents in Coolify UI"
echo "  Navigate to: Settings → Servers → Add Server"
echo ""
echo "  Server list:"
echo "    S2 (CMS):        10.0.0.10  — label: role=cms"
echo "    S3 (Data):       10.0.0.20  — label: role=data"
echo "    S4 (AI Compute): 10.0.0.40  — label: role=ai-compute"
echo "    S5 (Compute):    10.0.0.30  — label: role=compute"
echo ""

# Step 3: Create services
echo "Step 3: Create services in Coolify"
echo "  For each service, create a 'Docker Compose' type resource"
echo "  pointing to the repo with the docker-compose.prod.yml"
echo ""
echo "  Service → Server mapping:"
echo "    postgres         → S3 (10.0.0.20)"
echo "    redis            → S3 (10.0.0.20)"
echo "    otel-collector   → S3 (10.0.0.20)"
echo "    bl-gateway       → S1 (10.0.0.5)"
echo "    bl-cms           → S2 (10.0.0.10)"
echo "    bl-ai-api        → S4 (10.0.0.40)"
echo "    bl-flow-trigger  → S4 (10.0.0.40)"
echo "    bl-formula-api   → S5 (10.0.0.30)"
echo "    bl-flow-worker   → S5 (10.0.0.30)"
echo ""

# Step 4: Environment variables
echo "Step 4: Configure environment variables"
echo "  Add these in Coolify → Environment → Shared Variables:"
echo ""
echo "  # Database"
echo "  POSTGRES_DB=businesslogic"
echo "  POSTGRES_USER=businesslogic"
echo "  POSTGRES_PASSWORD=<generate-strong-password>"
echo ""
echo "  # Service auth tokens"
echo "  FORMULA_API_ADMIN_TOKEN=<generate>"
echo "  FLOW_TRIGGER_ADMIN_TOKEN=<generate>"
echo "  AI_API_ADMIN_TOKEN=<generate>"
echo "  TOKEN_ENCRYPTION_KEY=<64-hex-chars>"
echo ""
echo "  # AI providers"
echo "  ANTHROPIC_API_KEY=<your-key>"
echo "  OPENAI_API_KEY=<your-key>"
echo ""
echo "  # Domain"
echo "  DOMAIN=businesslogic.online"
echo ""

# Step 5: Mount PG volume on S3
echo "Step 5: Mount PostgreSQL volume on S3"
echo "  SSH to S3 and run:"
echo "    mkfs.ext4 /dev/disk/by-id/scsi-0HC_Volume_<vol-id>"
echo "    mkdir -p /mnt/bl-pg-data"
echo "    mount /dev/disk/by-id/scsi-0HC_Volume_<vol-id> /mnt/bl-pg-data"
echo "    echo '/dev/disk/by-id/scsi-0HC_Volume_<vol-id> /mnt/bl-pg-data ext4 defaults 0 2' >> /etc/fstab"
echo ""

# Step 6: Deploy
echo "Step 6: Deploy all services"
echo "  In Coolify, deploy services in order:"
echo "    1. postgres + redis (S3)"
echo "    2. bl-cms (S2)"
echo "    3. bl-formula-api (S5)"
echo "    4. bl-flow-trigger + bl-flow-worker (S4+S5)"
echo "    5. bl-ai-api (S4)"
echo "    6. bl-gateway (S1)"
echo "    7. otel-collector (S3)"
echo ""

# Step 7: Verify
echo "Step 7: Verify all services"
echo "  Run: ./scripts/health-check.sh"
echo "  Run: ./tests/security/audit.sh"
echo ""
echo "Done. All services should be accessible via https://api.businesslogic.online"

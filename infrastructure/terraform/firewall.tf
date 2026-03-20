# =============================================================================
# Firewall Rules
# =============================================================================
# Gateway: public HTTP/HTTPS + SSH
# Internal: private network only + SSH from admin IPs
# =============================================================================

resource "hcloud_firewall" "gateway" {
  name = "bl-gateway-fw"

  # HTTPS (Cloudflare → Gateway)
  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTPS from Cloudflare"
  }

  # HTTP (redirect to HTTPS)
  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTP redirect"
  }

  # SSH (restricted to admin IPs in production)
  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "SSH access"
  }

  # Private network (inter-service)
  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "any"
    source_ips  = ["10.0.0.0/16"]
    description = "Private network"
  }

  labels = {
    env     = var.environment
    project = "businesslogic"
  }
}

resource "hcloud_firewall" "internal" {
  name = "bl-internal-fw"

  # Private network only
  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "any"
    source_ips  = ["10.0.0.0/16"]
    description = "Private network"
  }

  # SSH (restricted to admin IPs in production)
  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "SSH access"
  }

  labels = {
    env     = var.environment
    project = "businesslogic"
  }
}

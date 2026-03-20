# =============================================================================
# Cloudflare DNS Records
# =============================================================================
# Points domain to gateway server. Cloudflare proxies traffic (orange cloud).
# =============================================================================

resource "cloudflare_record" "api" {
  count   = var.cloudflare_zone_id != "" ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = "api"
  content = hcloud_server.gateway.ipv4_address
  type    = "A"
  proxied = true
  ttl     = 1
  comment = "BusinessLogic API Gateway"
}

resource "cloudflare_record" "app" {
  count   = var.cloudflare_zone_id != "" ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = "app"
  content = hcloud_server.gateway.ipv4_address
  type    = "A"
  proxied = true
  ttl     = 1
  comment = "BusinessLogic CMS (proxied via gateway)"
}

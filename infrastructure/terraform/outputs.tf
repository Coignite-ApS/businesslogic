output "gateway_ip" {
  value       = hcloud_server.gateway.ipv4_address
  description = "Gateway server public IP"
}

output "cms_ip" {
  value       = hcloud_server.cms.ipv4_address
  description = "CMS server public IP"
}

output "data_ip" {
  value       = hcloud_server.data.ipv4_address
  description = "Data server public IP"
}

output "ai_compute_ip" {
  value       = hcloud_server.ai_compute.ipv4_address
  description = "AI compute server public IP"
}

output "compute_ip" {
  value       = hcloud_server.compute.ipv4_address
  description = "Compute server public IP"
}

output "private_ips" {
  value = {
    gateway    = "10.0.0.5"
    cms        = "10.0.0.10"
    data       = "10.0.0.20"
    compute    = "10.0.0.30"
    ai_compute = "10.0.0.40"
  }
  description = "Private network IPs"
}

output "pg_volume_id" {
  value       = hcloud_volume.pg_data.id
  description = "PostgreSQL data volume ID"
}

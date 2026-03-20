# Private network for inter-service communication.
# All services communicate over 10.0.0.0/24, no public exposure except gateway.

resource "hcloud_network" "private" {
  name     = "bl-private"
  ip_range = "10.0.0.0/16"

  labels = {
    env     = var.environment
    project = "businesslogic"
  }
}

resource "hcloud_network_subnet" "services" {
  network_id   = hcloud_network.private.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.0.0.0/24"
}

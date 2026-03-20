# =============================================================================
# Server Topology
# =============================================================================
# S1 — bl-gateway   (CX22)  — Gateway + Coolify controller
# S2 — bl-cms       (CX22)  — Directus CMS
# S3 — bl-data      (CX32)  — PostgreSQL + Redis
# S4 — bl-ai        (CX32)  — AI API + Flow engine
# S5 — bl-compute   (CPX31) — Formula API + Flow workers
# =============================================================================

resource "hcloud_ssh_key" "deploy" {
  name       = "bl-deploy"
  public_key = var.ssh_public_key
}

# S1: Gateway + Coolify controller
resource "hcloud_server" "gateway" {
  name        = "bl-gateway"
  server_type = "cx22"
  image       = "ubuntu-24.04"
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.deploy.id]

  network {
    network_id = hcloud_network.private.id
    ip         = "10.0.0.5"
  }

  labels = {
    role    = "gateway"
    env     = var.environment
    project = "businesslogic"
  }

  firewall_ids = [hcloud_firewall.gateway.id]

  depends_on = [hcloud_network_subnet.services]
}

# S2: CMS (Directus)
resource "hcloud_server" "cms" {
  name        = "bl-cms"
  server_type = "cx22"
  image       = "ubuntu-24.04"
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.deploy.id]

  network {
    network_id = hcloud_network.private.id
    ip         = "10.0.0.10"
  }

  labels = {
    role    = "cms"
    env     = var.environment
    project = "businesslogic"
  }

  firewall_ids = [hcloud_firewall.internal.id]

  depends_on = [hcloud_network_subnet.services]
}

# S3: Data (PostgreSQL + Redis)
resource "hcloud_server" "data" {
  name        = "bl-data"
  server_type = "cx32"
  image       = "ubuntu-24.04"
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.deploy.id]

  network {
    network_id = hcloud_network.private.id
    ip         = "10.0.0.20"
  }

  labels = {
    role    = "data"
    env     = var.environment
    project = "businesslogic"
  }

  firewall_ids = [hcloud_firewall.internal.id]

  depends_on = [hcloud_network_subnet.services]
}

# S4: AI Compute (AI API + Flow engine)
resource "hcloud_server" "ai_compute" {
  name        = "bl-ai-compute"
  server_type = "cx32"
  image       = "ubuntu-24.04"
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.deploy.id]

  network {
    network_id = hcloud_network.private.id
    ip         = "10.0.0.40"
  }

  labels = {
    role    = "ai-compute"
    env     = var.environment
    project = "businesslogic"
  }

  firewall_ids = [hcloud_firewall.internal.id]

  depends_on = [hcloud_network_subnet.services]
}

# S5: Compute (Formula API + Flow workers)
resource "hcloud_server" "compute" {
  name        = "bl-compute"
  server_type = "cpx31"
  image       = "ubuntu-24.04"
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.deploy.id]

  network {
    network_id = hcloud_network.private.id
    ip         = "10.0.0.30"
  }

  labels = {
    role    = "compute"
    env     = var.environment
    project = "businesslogic"
  }

  firewall_ids = [hcloud_firewall.internal.id]

  depends_on = [hcloud_network_subnet.services]
}

# PostgreSQL data volume (persistent, survives server rebuild)
resource "hcloud_volume" "pg_data" {
  name      = "bl-pg-data"
  size      = 50
  server_id = hcloud_server.data.id
  automount = false

  labels = {
    role    = "data"
    env     = var.environment
    project = "businesslogic"
  }
}

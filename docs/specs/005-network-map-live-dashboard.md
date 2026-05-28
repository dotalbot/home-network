# Network Map Live Dashboard Spec

Status: deployed (Phase 1 live)  
Number: 005  
Created: 2026-05-27  
Updated: 2026-05-27  

## Goal

Evolve the existing static Network Map (jellyberry:8788) into a live operations dashboard where topology nodes show real-time health from Prometheus, backup status from Borgmatic metrics, and active alerts from Alertmanager, with drill-down links to Grafana, Dozzle, Portainer, and Alertmanager.

## Constraints and decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Hosting** | Move to **jellybase** alongside Prometheus/Grafana | Zero network latency for metrics API calls; more RAM/disk headroom; co-located with the monitoring stack |
| **Architecture** | **Component rebuild** — refactor monolithic app.js into ES modules | Current app.js is ~630 lines of vanilla JS; modular ES modules keep the existing design while making each data source独立的 and maintainable |
| **Data architecture** | **Direct Prometheus/Alertmanager API calls** from the browser | Dashboard will be on jellybase, same host as Prometheus; no latency concern; add a thin proxy later if needed for CORS or multi-source aggregation |
| **Refresh strategy** | **Hybrid** — load on visit, auto-refresh every 60s, pause when tab hidden | Good live feel without wasting cycles on the Pi-class host or polling unnecessarily |
| **Framework** | No framework — vanilla JS ES modules | Homelab dashboard doesn't need React/Vue; keeping it dependency-free reduces build complexity |
| **Priority order** | 1. Live node health → 2. Backup status → 3. Alert sidebar → 4. iframe drill-downs → 5. Tailscale/Portainer data | Builds incrementally; each phase adds visible value |

## Scope

### In scope

- Real-time CPU, memory, disk, temperature, and container-count badges on topology nodes
- Backup status per host (last timestamp, success/fail, archive size) using borgmatic_* Prometheus metrics
- Alert feed sidebar pulling from Alertmanager v2 API, grouped by host, with node highlighting
- iframe drill-down links to Grafana kiosk panels, Dozzle logs, Portainer, Alertmanager
- Service-to-host linking in the Service Matrix view (health, container status, backup state, direct URL)
- Move deployment from jellyberry to jellybase via home-network Compose overlay

### Out of scope (for now)

- Write actions (restart containers, acknowledge alerts, trigger backups)
- Authentication or reverse proxy
- Historical graphs / sparklines (Phase 2 enhancement)
- Mobile-native layouts (responsive is in scope; dedicated mobile UI is not)
- Tailscale API or Portainer API integration (Phase 2)
- Home Assistant REST API integration (Phase 2)

## Data sources

| Source | Endpoint | Query/metric | Refresh |
|--------|----------|-------------|---------|
| **Prometheus** | `http://jellybase:9090/api/v1/query` | `up`, `node_load5`, `node_memory_MemAvailable_bytes`, `node_filesystem_avail_bytes`, `node_hwmon_temp_celsius`, `container_running` (from cAdvisor if available), `borgmatic_*` | 60s |
| **Alertmanager** | `http://jellybase:9093/api/v2/alerts` | All firing alerts, grouped by `host` label | 60s |
| **Grafana** | `http://jellybase:3001` | Kiosk-mode iframe embeds for per-host dashboards | On demand |
| **Dozzle** | `http://jellyhome:8080` (central UI) | Direct links to container logs per host | On demand |
| **Portainer** | `https://jellyhome:9443` | Direct links to container management per host | On demand |

### Prometheus queries for node health

```promql
# Online status
up{job="node_exporter"}

# CPU load (5-min average)
node_load5{job="node_exporter"}

# Memory available bytes
node_memory_MemAvailable_bytes{job="node_exporter"}

# Memory total bytes
node_memory_MemTotal_bytes{job="node_exporter"}

# Filesystem available bytes (root filesystem)
node_filesystem_avail_bytes{job="node_exporter",mountpoint="/",fstype!~"tmpfs|sysfs|devtmpfs"}

# Filesystem size bytes (root filesystem)
node_filesystem_size_bytes{job="node_exporter",mountpoint="/",fstype!~"tmpfs|sysfs|devtmpfs"}

# Temperature sensors
node_hwmon_temp_celsius{job="node_exporter"}

# Borgmatic: last run timestamp
borgmatic_last_run_timestamp_seconds{job="node_exporter"}

# Borgmatic: last run duration
borgmatic_last_run_duration_seconds{job="node_exporter"}

# Borgmatic: latest archive metadata
borgmatic_last_archive_info{job="node_exporter"}

# Borgmatic: backup success (1=success, 0=fail)
borgmatic_last_run_success{job="node_exporter"}

# Borgmatic: repository reachability
borgmatic_repository_reachable{job="node_exporter"}
```

### Alertmanager query

```
GET http://jellybase:9093/api/v2/alerts?filter=...
```

Returns all firing alerts. Group by the `host` label to associate with topology nodes.

## Module architecture

```
network-map/
├── index.html              # Shell, CSS, navigation tabs
├── app.js                  # Entry point: router, init, 60s refresh loop
├── modules/
│   ├── api.js              # Prometheus + Alertmanager fetch helpers
│   ├── topology.js         # Topology rendering (existing SVG/canvas map)
│   ├── node-health.js      # Node health overlays (CPU/temp/disk/containers)
│   ├── backup-status.js    # Backup status panel per host
│   ├── alerts.js           # Alert feed sidebar
│   ├── service-matrix.js   # Enhanced service matrix with health/backup
│   ├── drilldown.js        # iframe/modal drill-down links
│   └── filters.js          # Search, source filter, category filter
├── data/
│   ├── inventory.json      # Static inventory (existing)
│   └── health.json         # Cached/promised live health data
├── styles.css              # Existing styles, modular extensions
└── Dockerfile              # nginx:alpine serving static files
```

## Host mapping

The network-map inventory `lan_devices` already contains host entries. The module maps these hosts to Prometheus targets by hostname label:

| Inventory host | Prometheus instance | Notes |
|----------------|-------------------|-------|
| jellyhome | `jellyhome:9100` | Main server |
| jellybase | `host.docker.internal:9100` | Prometheus self-host scrapes as `host.docker.internal` |
| jellyberry | `jellyberry:9100` | Pi |
| jellybackup | (not scraped yet) | Backup target; no node_exporter |

The `host` label in Prometheus metrics (where available) or a config mapping resolves the instance name to the topology node.

## Visual design

### Node health badges

Each topology node gets a colored ring/badge showing aggregate health:

- **Green**: all metrics normal, no firing alerts
- **Amber**: warning-level alerts or elevated metrics (e.g., disk >80%, temp >60°C)
- **Red**: critical alerts or elevated metrics (e.g., node down, disk >95%)
- **Grey**: no data (node not scraped, no metrics available)

On hover/click, show a popover with:
- CPU load (5-min avg)
- Memory used/total (percentage)
- Disk used/total (percentage, root filesystem)
- Temperature (highest sensor)
- Container count (up vs total from inventory)
- Online status (up=1 / down=0)

### Backup status panel

For each monitored host, show:
- Last run timestamp (humanized: "2h ago", "3d ago")
- Success/fail indicator from `borgmatic_last_run_success` and `borgmatic_last_run_exit_code`
- Repository reachability from `borgmatic_repository_reachable`
- Latest archive name from `borgmatic_last_archive_info`
- Click-through/detail panel with borgmatic_* metric breakdown

### Alert feed sidebar

- Right sidebar/panel, collapsible on mobile
- Sorted by severity (critical > warning > info)
- Group by `monitored_host`/`host` label
- Click an alert → select the affected host in the detail panel
- Alert details include severity, state, age, summary, and description

### iframe drill-down

- Host/detail popovers include drill-down buttons for Grafana Host Observability, Grafana Borgmatic Backups, Prometheus, Alertmanager, Dozzle, and Portainer.
- Links open in an in-page iframe modal with a separate “Open new tab” fallback for dashboards that block embedding or require login.
- Grafana links pass `var-host=<host>` and kiosk/time-range parameters where applicable.
- Alertmanager links include a host filter where the Alertmanager UI supports it.

Modal/panel overlay with tabs:
- Grafana: embed kiosk-mode per-host dashboard panel
- Dozzle: link to per-host container logs
- Portainer: link to per-host container management  
- Alertmanager: link to current alerts for that host

Grafana kiosk embed URL pattern:
```
http://jellybase:3001/d/<dashboard-uid>?kiosk&theme=dark&var-host=<hostname>
```

## CORS considerations

When the dashboard runs on jellybase, both it and Prometheus/Alertmanager are on the same host. The browser will need CORS headers if serving from a different port or origin. Options:

1. **Same-origin proxy via nginx**: Serve the dashboard on jellybase:8788 and proxy `/api/prometheus/*` and `/api/alerts/*` to localhost:9090 and :9093. This avoids CORS entirely.
2. **CORS headers on Prometheus/Alertmanager**: Configure Prometheus `--web.cors.origin` flag. Prometheus v2 supports `Access-Control-Allow-Origin` via `web.cors.origin`.

**Decision**: Option 1 (nginx reverse proxy) — cleaner, no need to modify Prometheus/Alertmanager config, and keeps all API calls same-origin from the browser perspective.

### nginx proxy configuration

The deployed nginx.conf uses Docker DNS service names (not localhost) since the containers are on the same Docker network:

```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # Static files
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy to Prometheus
    location /api/prometheus/query {
        set $args $query_string;
        proxy_pass http://prometheus:9090/api/v1/query;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
    }

    # API proxy to Prometheus query_range (for future sparklines)
    location /api/prometheus/query_range {
        set $args $query_string;
        proxy_pass http://prometheus:9090/api/v1/query_range;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
    }

    # API proxy to Alertmanager
    location /api/alerts {
        proxy_pass http://alertmanager:9093/api/v2/alerts;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
    }

    # Data files
    location /data/ {
        try_files $uri =404;
    }
}
```

## Deployment: move to jellybase

### Current state (jellyberry)

```yaml
# jellyberry overlay — network-map service
network-map:
  image: nginx:alpine
  container_name: network-map
  ports:
    - "8788:80"
  volumes:
    - /opt/docker/appdata/network-map/site:/usr/share/nginx/html:ro
```

### Target state (jellybase) — DEPLOYED

```yaml
# jellybase overlay — network-map service
network-map:
  build:
    context: /home/jellyfish/repo/home-network/docker/network-map
    dockerfile: Dockerfile
  image: network-map:latest
  container_name: network-map
  restart: unless-stopped
  ports:
    - "8788:80"
  volumes:
    - /opt/docker/appdata/network-map/site:/usr/share/nginx/html:ro
  depends_on:
    - prometheus
    - alertmanager
```

With a custom `Dockerfile` that includes nginx CORS proxy config:

```dockerfile
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

And `nginx.conf` with the reverse proxy routes above.

### Migration steps

1. ✅ Build the modular dashboard locally in the home-network repo (on branch `feat/network-map-live-dashboard`, merged to main)
2. ✅ Test on jellyberry port 8788 with degraded health data (no Prometheus proxy — shows "0 nodes" gracefully)
3. ✅ Add network-map to jellybase Compose overlay with nginx proxy config (`docker/hosts/jellybase.yaml` updated)
4. ✅ Remove network-map from jellyberry overlay (`docker/hosts/jellyberry.yaml` updated)
5. ✅ Update inventory/services.yml to reflect the move
6. ✅ Sync site files to jellybase's `/opt/docker/appdata/network-map/site/`
7. ✅ Build the nginx-proxy Docker image on jellybase
8. ✅ Deploy to jellybase: `just up network-map`
9. ✅ Verify at http://jellybase:8788 — topology loads, health data shows for 3 nodes
10. ✅ Verify Prometheus proxy: `curl http://jellybase:8788/api/prometheus/query?query=up` returns JSON
11. ✅ Verify Alertmanager proxy: `curl http://jellybase:8788/api/alerts` returns JSON
12. ✅ Stop network-map on jellyberry (container removed)
13. ✅ Merge branch to main and push
14. ✅ Add `depends_on: [prometheus, alertmanager]` to jellybase compose overlay
15. ✅ Fix nginx proxy to use Docker DNS names (`prometheus:9090`, `alertmanager:9093`) instead of `localhost`
16. ✅ Fix `sync-docker-config` script: `chgrp -R` on root-owned alertmanager data now uses `2>/dev/null || true`
17. ✅ Add `jellyfood-api` service to jellybase compose overlay and inventory/services.yml

## Implementation phases

### Phase 1: Live node health on topology ✅

**Status**: Deployed and live on jellybase:8788

**Completed tasks**:
1. ✅ Refactored app.js into ES modules: extracted topology rendering, data loading, filters, api, and utils
2. ✅ Created `modules/api.js` with Prometheus query helpers (fetchJson, queryPrometheus)
3. ✅ Created `modules/node-health.js` with health badge rendering and popover logic
4. ✅ Created nginx proxy config for `/api/prometheus/query`, `/api/prometheus/query_range`, and `/api/alerts` routes
5. ✅ Built custom Dockerfile with nginx.conf (using Docker DNS names: `prometheus:9090`, `alertmanager:9093`)
6. ✅ Added health query calls to the 60s refresh loop
7. ✅ Wired health data to topology node colors and popovers
8. ✅ Tested on jellyberry first (no Prometheus proxy — showed "0 nodes" gracefully)
9. ✅ Migrated deployment from jellyberry to jellybase alongside Prometheus/Alertmanager
10. ✅ Stopped old network-map container on jellyberry

**Current behaviour**:
- Dashboard at http://jellybase:8788 (or http://100.125.86.118:8788 via Tailscale)
- Shows "Health data: 3 nodes" (jellybase, jellyhome, jellyberry)
- Prometheus queries proxied through nginx at `/api/prometheus/query`
- Alertmanager queries proxied through nginx at `/api/alerts`
- Uses Docker service DNS for inter-container communication

### Phase 2: Backup status per host

**Objective**: Each monitored host shows its latest backup status using borgmatic_* metrics.

**Tasks**:
1. Create `modules/backup-status.js` with backup panel rendering
2. Add borgmatic Prometheus queries to api.js
3. Render backup cards in node detail popover (timestamp, size, success/fail)
4. Add backup summary to node health badge (overlay indicator if backup stale/failed)

**Acceptance**:
- Each host with borgmatic metrics shows last backup time, size, status
- Stale (>24h) or failed backups show amber/red indicator on the node
- Hosts without borgmatic data show "not backed up" label

### Phase 3: Alert feed sidebar

**Objective**: Live Alertmanager feed grouped by host, with node highlighting.

**Tasks**:
1. Create `modules/alerts.js` with Alertmanager v2 API fetch
2. Add nginx proxy route for `/api/alerts/`
3. Render alert sidebar with severity colour, host group, description
4. Click alert → highlight corresponding node on topology
5. Node color blends with worst active alert severity

**Acceptance**:
- Sidebar shows all firing alerts from Alertmanager
- Clicking an alert highlights the affected node
- Nodes with alerts show amber/red tint even without hover

### Phase 4: iframe drill-down links

**Objective**: Click a node or service to open drill-down panels.

**Tasks**:
1. Create `modules/drilldown.js` with modal/panel rendering
2. Add Grafana kiosk embed URLs per host dashboard
3. Add direct links to Dozzle (per-host), Portainer (per-host), Alertmanager
4. Handle Home Assistant link for jellyhome

**Acceptance**:
- Clicking a node opens a panel with tabs: Grafana, Dozzle, Portainer, Alerts
- Grafana tab loads kiosk-mode per-host dashboard iframe
- Direct links open in new tab for Dozzle, Portainer, Alertmanager

### Phase 5: Enhanced Service Matrix

**Objective**: Service Matrix view shows health, container status, backup state, and direct URL.

**Tasks**:
1. Create `modules/service-matrix.js` with enhanced service cards
2. Cross-reference inventory services with live health data
3. Add container running status from inventory/health data
4. Add backup class from inventory
5. Add direct URL link to each service card

**Acceptance**:
- Each service card shows health indicator, container status, backup class
- Cards link directly to service URL
- Color coding matches alert/health status

## Test plan

| Test | Method | Expected |
|------|--------|----------|
| Prometheus API reachable | `curl jellybase:9090/api/v1/query?query=up` | Returns all scraped targets with value 1 |
| Alertmanager API reachable | `curl jellybase:9093/api/v2/alerts` | Returns JSON array of current alerts |
| nginx proxy | `curl jellybase:8788/api/prometheus/query?query=up` | Proxied Prometheus response |
| CORS headers | Browser fetch from `http://jellybase:8788` to `/api/prometheus/*` | No CORS errors in console |
| Node health display | Load dashboard in browser | All 3 scraped hosts show health badges |
| Backup display | Load dashboard, hover jellyhome | Shows last backup timestamp and size |
| Alert sidebar | Load dashboard when alerts are firing | Sidebar shows alerts grouped by host |
| Tab pause | Switch browser tab for 2+ minutes, return | No stale data; next refresh cycle picks up |
| Mobile responsive | Load on phone-width viewport | Sidebar collapses, topology scrolls |

## Rollback

- Keep the existing static network-map on jellyberry:8788 as a fallback during development
- The nginx:alpine container serves static files; redeploying an older `site/` directory rolls back instantly
- If jellybase hosting has issues, we can revert the Compose overlay back to jellyberry

## Risks

| Risk | Mitigation |
|------|-----------|
| Prometheus API latency on refresh | 60s interval; pause when tab hidden; keep fallback static data |
| CORS issues in development | Use nginx proxy; don't rely on browser CORS for same-origin |
| Temperature sensors vary by host | Show "No sensor data" for hosts without hwmon; don't guess |
| jellybackup not scraped | Show explicit "not monitored" badge; don't silently skip |
| Alertmanager returns many alerts | Filter by host labels; group by severity; cap sidebar display |
| App.js refactor breaks existing features | Incremental module extraction; test after each module split |

## Future enhancements (Phase 2+)

- Tailscale API integration for peer connectivity and "last seen"
- Portainer API for live container count per host
- Home Assistant REST API for IoT device health
- Historical sparklines (requires time-range queries)
- Authentication for dashboard access
- Host reboot detection (node_boot_time_seconds metric)
- Network throughput panels (node_network_* metrics)
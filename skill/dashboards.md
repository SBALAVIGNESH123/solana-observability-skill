# Grafana Dashboards — Dashboard-as-Code with Terraform

Pre-built Grafana dashboards for Solana observability with provisioning automation.

## Dashboard Overview

| Dashboard | Panels | Purpose |
|-----------|--------|---------|
| Solana Overview | 12 | High-level health: RPC status, tx rate, slot progress |
| Transaction Deep-Dive | 8 | Landing rate, CU distribution, error breakdown |
| Validator Performance | 10 | Skip rate, credits, stake, delinquency |
| Security Monitor | 6 | Authority changes, balance alerts, exploit detection |
| Geyser Pipeline | 6 | Stream health, backpressure, reconnects |

## Terraform Provisioning

```hcl
# dashboards.tf
resource "grafana_dashboard" "solana_overview" {
  config_json = file("${path.module}/dashboards/solana-overview.json")
  folder      = grafana_folder.solana.id
  overwrite   = true
}

resource "grafana_folder" "solana" {
  title = "Solana Observability"
}

resource "grafana_data_source" "prometheus" {
  type = "prometheus"
  name = "Solana Metrics"
  url  = var.prometheus_url

  json_data_encoded = jsonencode({
    timeInterval = "15s"
  })
}

resource "grafana_alert_notification" "pagerduty" {
  name = "PagerDuty - Solana"
  type = "pagerduty"

  settings = jsonencode({
    integrationKey = var.pagerduty_key
    autoResolve    = true
  })
}
```

## Key PromQL Panels

### Transaction Landing Rate (Time Series)
```promql
# Success rate
sum(rate(solana_tx_landed_total{status="success"}[5m])) / sum(rate(solana_tx_submitted_total[5m]))
```

### CU Utilization Heatmap
```promql
# Histogram heatmap of CU consumption
sum(rate(solana_compute_units_used_bucket[5m])) by (le)
```

### RPC Health Matrix (Stat Panel)
```promql
# Per-provider health (1 = up, 0 = down)
solana_rpc_up
```

### Error Budget Burn (Gauge)
```promql
# Remaining error budget percentage
(1 - (sum(increase(solana_tx_dropped_total[30d])) / (sum(increase(solana_tx_submitted_total[30d])) * 0.005))) * 100
```

### Slot Progress (Graph)
```promql
# Current slot with expected progression overlay
solana_slot_current
```

## Docker Compose Stack

```yaml
# docker-compose.observability.yml
services:
  prometheus:
    image: prom/prometheus:v2.53.0
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=30d'
      - '--web.enable-lifecycle'
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - ./prometheus/rules/:/etc/prometheus/rules/
      - prometheus-data:/prometheus
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:11.1.0
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD:-admin}
      GF_INSTALL_PLUGINS: grafana-piechart-panel
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning
      - ./grafana/dashboards:/var/lib/grafana/dashboards
      - grafana-data:/var/lib/grafana
    ports:
      - "3000:3000"

  alertmanager:
    image: prom/alertmanager:v0.27.0
    volumes:
      - ./alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml
    ports:
      - "9093:9093"

  loki:
    image: grafana/loki:3.1.0
    command: -config.file=/etc/loki/config.yml
    volumes:
      - ./loki/config.yml:/etc/loki/config.yml
      - loki-data:/loki
    ports:
      - "3100:3100"

volumes:
  prometheus-data:
  grafana-data:
  loki-data:
```

## Prometheus Configuration

```yaml
# prometheus/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "rules/*.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

scrape_configs:
  - job_name: 'solana-collector'
    static_configs:
      - targets: ['geyser-collector:9090']
    scrape_interval: 5s

  - job_name: 'solana-server'
    static_configs:
      - targets: ['sketchlog-server:8000']
    metrics_path: '/metrics'
```

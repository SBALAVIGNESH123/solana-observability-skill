# SLO-Based Alerting — Multi-Window Burn Rates (Google SRE Methodology)

Define Service Level Objectives for Solana applications and alert on error budget consumption rate — not raw thresholds.

## SLO Framework

### Core Concepts

| Term | Definition | Example |
|------|-----------|---------|
| **SLI** (Service Level Indicator) | Measurable metric | `tx_landed / tx_submitted` |
| **SLO** (Service Level Objective) | Target for SLI | "99.5% of transactions land within 30s" |
| **Error Budget** | Allowed failures | 0.5% = ~4,320 failures/day at 20 tx/s |
| **Burn Rate** | How fast budget is consumed | 2× = exhausted in 12h instead of 30d |

### Defining SLOs for Solana

```yaml
# slo-config.yaml
slos:
  - name: transaction_landing
    sli:
      numerator: solana_tx_landed_total{status="success"}
      denominator: solana_tx_submitted_total
    target: 0.995          # 99.5%
    window: 30d            # monthly budget
    alerts:
      - burn_rate: 14.4    # budget exhausted in 2h → page immediately
        short_window: 5m
        long_window: 1h
        severity: critical
      - burn_rate: 6       # budget exhausted in 5h → page
        short_window: 30m
        long_window: 6h
        severity: critical
      - burn_rate: 1       # budget exhausted in 30d → ticket
        short_window: 6h
        long_window: 3d
        severity: warning

  - name: rpc_availability
    sli:
      numerator: solana_rpc_request_duration_seconds_count{status="success"}
      denominator: solana_rpc_request_duration_seconds_count
    target: 0.999          # 99.9%
    window: 30d
    alerts:
      - burn_rate: 14.4
        short_window: 5m
        long_window: 1h
        severity: critical
      - burn_rate: 6
        short_window: 30m
        long_window: 6h
        severity: critical

  - name: rpc_latency
    sli:
      # Requests completing within 500ms
      good: histogram_quantile(0.95, rate(solana_rpc_request_duration_seconds_bucket[5m])) < 0.5
    target: 0.99           # 99% of 5m windows have p95 < 500ms
    window: 30d
```

## Multi-Window Burn Rate Alerts (Prometheus Rules)

```yaml
groups:
  - name: solana_slo_burn_rate
    rules:
      # Recording rules for SLI error rate
      - record: solana:tx_landing:error_rate_5m
        expr: 1 - (sum(rate(solana_tx_landed_total{status="success"}[5m])) / sum(rate(solana_tx_submitted_total[5m])))

      - record: solana:tx_landing:error_rate_30m
        expr: 1 - (sum(rate(solana_tx_landed_total{status="success"}[30m])) / sum(rate(solana_tx_submitted_total[30m])))

      - record: solana:tx_landing:error_rate_1h
        expr: 1 - (sum(rate(solana_tx_landed_total{status="success"}[1h])) / sum(rate(solana_tx_submitted_total[1h])))

      - record: solana:tx_landing:error_rate_6h
        expr: 1 - (sum(rate(solana_tx_landed_total{status="success"}[6h])) / sum(rate(solana_tx_submitted_total[6h])))

      - record: solana:tx_landing:error_rate_3d
        expr: 1 - (sum(rate(solana_tx_landed_total{status="success"}[3d])) / sum(rate(solana_tx_submitted_total[3d])))

      # Burn rate calculation: error_rate / error_budget
      # Error budget = 1 - SLO target = 1 - 0.995 = 0.005
      - record: solana:tx_landing:burn_rate_5m
        expr: solana:tx_landing:error_rate_5m / 0.005

      - record: solana:tx_landing:burn_rate_1h
        expr: solana:tx_landing:error_rate_1h / 0.005

      - record: solana:tx_landing:burn_rate_6h
        expr: solana:tx_landing:error_rate_6h / 0.005

      # Multi-window alerts
      - alert: TxLandingSLOCriticalBurn
        expr: solana:tx_landing:burn_rate_5m > 14.4 AND solana:tx_landing:burn_rate_1h > 14.4
        for: 2m
        labels:
          severity: critical
          slo: transaction_landing
        annotations:
          summary: "TX landing SLO burning 14.4× — budget exhausted in ~2 hours"
          burn_rate: "{{ $value }}"
          action: "Page on-call immediately"

      - alert: TxLandingSLOHighBurn
        expr: solana:tx_landing:burn_rate_30m > 6 AND solana:tx_landing:burn_rate_6h > 6
        for: 5m
        labels:
          severity: critical
          slo: transaction_landing
        annotations:
          summary: "TX landing SLO burning 6× — budget exhausted in ~5 hours"

      - alert: TxLandingSLOSlowBurn
        expr: solana:tx_landing:burn_rate_6h > 1 AND solana:tx_landing:burn_rate_3d > 1
        for: 30m
        labels:
          severity: warning
          slo: transaction_landing
        annotations:
          summary: "TX landing SLO slowly degrading — budget at risk for the month"
          action: "Create ticket, investigate root cause"
```

## Error Budget Remaining (Grafana Panel Query)

```promql
# Error budget remaining (percentage)
1 - (
  sum(increase(solana_tx_submitted_total[30d])) - sum(increase(solana_tx_landed_total{status="success"}[30d]))
) / (
  sum(increase(solana_tx_submitted_total[30d])) * 0.005
)
```

## Webhook + PagerDuty Integration

```typescript
interface AlertConfig {
  pagerdutyKey?: string;
  slackWebhook?: string;
  opsgenieKey?: string;
}

export class SLOAlertRouter {
  private config: AlertConfig;

  constructor(config: AlertConfig) {
    this.config = config;
  }

  async routeAlert(alert: { severity: string; slo: string; burnRate: number; message: string }): Promise<void> {
    if (alert.severity === 'critical') {
      // Page immediately via PagerDuty
      if (this.config.pagerdutyKey) {
        await this.sendPagerDuty(alert);
      }
      // Also notify Slack
      if (this.config.slackWebhook) {
        await this.sendSlack(alert, ':rotating_light:');
      }
    } else if (alert.severity === 'warning') {
      // Slack only — don't page for slow burns
      if (this.config.slackWebhook) {
        await this.sendSlack(alert, ':warning:');
      }
    }
  }

  private async sendPagerDuty(alert: any): Promise<void> {
    await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routing_key: this.config.pagerdutyKey,
        event_action: 'trigger',
        payload: {
          summary: `[${alert.slo}] ${alert.message}`,
          severity: alert.severity,
          source: 'solana-observability',
          custom_details: { burn_rate: alert.burnRate },
        },
      }),
    });
  }

  private async sendSlack(alert: any, emoji: string): Promise<void> {
    await fetch(this.config.slackWebhook!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `${emoji} *SLO Alert*: ${alert.slo}\nBurn rate: ${alert.burnRate}×\n${alert.message}`,
      }),
    });
  }
}
```

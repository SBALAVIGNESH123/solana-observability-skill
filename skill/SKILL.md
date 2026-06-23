---
name: solana-observability-skill
description: Production-grade observability for Solana programs — real-time metrics, Geyser gRPC streaming, validator monitoring, security alerts, SLO burn-rate tracking, cost optimization, chaos testing, and incident response automation.
version: 2.0.0
author: SBALAVIGNESH123
extends:
  - solana-dev-skill
tags:
  - observability
  - monitoring
  - metrics
  - alerting
  - solana
  - geyser
  - prometheus
  - grafana
  - opentelemetry
  - chaos-engineering
---

# Solana Observability Skill

Production-grade observability for Solana programs, validators, and infrastructure. Covers the full lifecycle: instrumentation → collection → alerting → dashboards → incident response → chaos validation.

## When to Use This Skill

Load this skill when the user needs to:
- Monitor Solana RPC node health, latency, or availability
- Track on-chain program metrics (CU usage, transaction success/failure rates)
- Set up Geyser gRPC (Yellowstone) streaming for real-time data
- Monitor validator performance (vote latency, skip rate, delinquency)
- Detect security anomalies (authority changes, large drains, exploit patterns)
- Define and track SLOs with multi-window burn rates
- Build Grafana dashboards or Prometheus alerting pipelines
- Implement distributed tracing with OpenTelemetry
- Optimize compute unit allocation and priority fee strategy
- Validate monitoring coverage with chaos engineering
- Respond to production incidents with structured runbooks

## Skill Files — Progressive Loading

Only load the file relevant to the current task:

| Task Domain | File | Load When |
|-------------|------|-----------|
| RPC health, failover, QoS routing | [rpc-monitoring.md](./rpc-monitoring.md) | User mentions RPC, node health, failover, rate limits |
| Transaction metrics & MEV | [transaction-metrics.md](./transaction-metrics.md) | User mentions tx latency, landing rate, Jito, bundles |
| Geyser gRPC / Yellowstone streaming | [geyser-streaming.md](./geyser-streaming.md) | User mentions Geyser, real-time, streaming, Yellowstone |
| Program instrumentation & CU profiling | [program-instrumentation.md](./program-instrumentation.md) | User mentions CU, compute units, program logs, events |
| Validator monitoring | [validator-monitoring.md](./validator-monitoring.md) | User mentions validator, vote, skip rate, delinquency |
| Security & exploit detection | [security-monitoring.md](./security-monitoring.md) | User mentions security, authority change, drain, exploit |
| SLOs, alerting, burn rates | [alerting-slo.md](./alerting-slo.md) | User mentions SLO, alerts, PagerDuty, burn rate |
| Grafana dashboards & Terraform | [dashboards.md](./dashboards.md) | User mentions dashboard, Grafana, visualization |
| Distributed tracing & OpenTelemetry | [distributed-tracing.md](./distributed-tracing.md) | User mentions tracing, spans, OpenTelemetry, Jaeger |
| Cost optimization & priority fees | [cost-optimization.md](./cost-optimization.md) | User mentions CU cost, priority fees, savings, optimization |
| Chaos testing & resilience | [chaos-testing.md](./chaos-testing.md) | User mentions chaos testing, resilience, failure injection, validation |
| Resources & SDK reference | [resources.md](./resources.md) | User asks for links, SDKs, or tool recommendations |

## Agents

| Agent | Purpose |
|-------|---------|
| [Observability Architect](../agents/observability-architect.md) | Designs full monitoring stacks from scratch |
| [Incident Responder](../agents/incident-responder.md) | Guides through active incidents with runbooks |
| [Metrics Engineer](../agents/metrics-engineer.md) | Implements specific metrics, dashboards, alerts |

## Commands

| Command | Purpose |
|---------|---------|
| `/obs-health-check` | Run a comprehensive health check on Solana infrastructure |
| `/obs-dashboard-gen` | Generate a Grafana dashboard for a specific program |
| `/obs-alert-audit` | Audit existing alert rules for gaps and noise |

## Key Principles

1. **Metrics are cheap, outages are expensive** — instrument everything, alert selectively
2. **Use Geyser gRPC for real-time** — polling is for health checks, streaming is for metrics
3. **SLOs drive alerting** — alert on burn rate, not raw thresholds
4. **Progressive disclosure** — start with RPC health, add depth as needed
5. **Solana-native** — respect slot-based time, leader schedules, and epoch boundaries
6. **Validate with chaos** — untested monitoring is theoretical monitoring
7. **Cost-aware** — optimize CU allocation and priority fees to minimize spend

## Quick Start Example

```typescript
// Minimal RPC health monitor — runs in 30 seconds
import { Connection } from '@solana/web3.js';
import { Histogram, Registry, collectDefaultMetrics } from 'prom-client';

const registry = new Registry();
collectDefaultMetrics({ register: registry });

const rpcLatency = new Histogram({
  name: 'solana_rpc_request_duration_seconds',
  help: 'RPC request latency',
  labelNames: ['method', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

async function monitorRPC(endpoint: string) {
  const conn = new Connection(endpoint, 'confirmed');
  const start = performance.now();
  try {
    const slot = await conn.getSlot();
    rpcLatency.observe({ method: 'getSlot', status: 'ok' }, (performance.now() - start) / 1000);
    return { healthy: true, slot, latency: performance.now() - start };
  } catch (err: any) {
    rpcLatency.observe({ method: 'getSlot', status: 'error' }, (performance.now() - start) / 1000);
    return { healthy: false, error: err.message };
  }
}
```

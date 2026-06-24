# RPC Monitoring -- QoS-Aware with Stake-Weighted Routing

Production RPC health monitoring with intelligent failover, rate-limit awareness, and stake-weighted endpoint selection.

## Multi-Provider Health Monitor

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { Counter, Histogram, Gauge, Registry } from 'prom-client';

interface RPCEndpoint {
  url: string;
  provider: string;
  weight: number;          // stake-weight or priority (higher = preferred)
  rateLimit: number;       // requests per second allowed
  tier: 'premium' | 'standard' | 'free';
}

interface HealthStatus {
  endpoint: RPCEndpoint;
  healthy: boolean;
  latencyMs: number;
  slot: number;
  behindBy: number;        // slots behind the leader
  consecutiveFailures: number;
  lastCheck: number;
  rateLimitRemaining: number;
}

export class RPCHealthMonitor {
  private endpoints: RPCEndpoint[];
  private statuses: Map<string, HealthStatus> = new Map();
  private metrics: RPCMetrics;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private globalSlotTip = 0;

  constructor(endpoints: RPCEndpoint[], registry: Registry) {
    this.endpoints = endpoints;
    this.metrics = new RPCMetrics(registry);
  }

  async start(intervalMs = 5000): Promise<void> {
    await this.checkAll();
    this.checkInterval = setInterval(() => this.checkAll(), intervalMs);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  async checkAll(): Promise<void> {
    const results = await Promise.allSettled(
      this.endpoints.map(ep => this.checkEndpoint(ep))
    );

    // Update global slot tip (highest seen)
    for (const [, status] of this.statuses) {
      if (status.healthy && status.slot > this.globalSlotTip) {
        this.globalSlotTip = status.slot;
      }
    }

    // Calculate behind-by for each endpoint
    for (const [, status] of this.statuses) {
      status.behindBy = this.globalSlotTip - status.slot;
      this.metrics.slotBehind.set(
        { provider: status.endpoint.provider },
        status.behindBy
      );
    }
  }

  private async checkEndpoint(ep: RPCEndpoint): Promise<void> {
    const conn = new Connection(ep.url, { commitment: 'processed' });
    const start = performance.now();
    let status = this.statuses.get(ep.url) || {
      endpoint: ep,
      healthy: false,
      latencyMs: 0,
      slot: 0,
      behindBy: 0,
      consecutiveFailures: 0,
      lastCheck: 0,
      rateLimitRemaining: ep.rateLimit,
    };

    try {
      const slot = await conn.getSlot();
      const latency = performance.now() - start;

      status.healthy = true;
      status.latencyMs = latency;
      status.slot = slot;
      status.consecutiveFailures = 0;
      status.lastCheck = Date.now();

      this.metrics.rpcLatency.observe(
        { provider: ep.provider, method: 'getSlot', status: 'success' },
        latency / 1000
      );
      this.metrics.rpcUp.set({ provider: ep.provider }, 1);
    } catch (err: any) {
      const latency = performance.now() - start;
      status.healthy = false;
      status.consecutiveFailures++;
      status.lastCheck = Date.now();

      this.metrics.rpcLatency.observe(
        { provider: ep.provider, method: 'getSlot', status: 'error' },
        latency / 1000
      );
      this.metrics.rpcUp.set({ provider: ep.provider }, 0);
      this.metrics.rpcErrors.inc({
        provider: ep.provider,
        error_type: this.classifyError(err),
      });

      // Alert if all endpoints for a tier are down
      if (status.consecutiveFailures >= 3) {
        this.metrics.rpcConsecutiveFailures.set(
          { provider: ep.provider },
          status.consecutiveFailures
        );
      }
    }

    this.statuses.set(ep.url, status);
  }

  /** Get the best available endpoint using weighted selection */
  getBestEndpoint(): RPCEndpoint | null {
    const healthy = [...this.statuses.values()]
      .filter(s => s.healthy && s.behindBy < 5)
      .sort((a, b) => {
        // Sort by: weight (desc), then latency (asc), then behindBy (asc)
        if (b.endpoint.weight !== a.endpoint.weight) return b.endpoint.weight - a.endpoint.weight;
        if (a.latencyMs !== b.latencyMs) return a.latencyMs - b.latencyMs;
        return a.behindBy - b.behindBy;
      });

    return healthy.length > 0 ? healthy[0].endpoint : null;
  }

  /** Weighted random selection (for load distribution) */
  getWeightedEndpoint(): RPCEndpoint | null {
    const healthy = [...this.statuses.values()].filter(s => s.healthy && s.behindBy < 5);
    if (healthy.length === 0) return null;

    const totalWeight = healthy.reduce((sum, s) => sum + s.endpoint.weight, 0);
    let random = Math.random() * totalWeight;

    for (const status of healthy) {
      random -= status.endpoint.weight;
      if (random <= 0) return status.endpoint;
    }
    return healthy[healthy.length - 1].endpoint;
  }

  /** Circuit breaker: temporarily remove endpoints with repeated failures */
  getCircuitBreakerStatus(): { open: string[]; halfOpen: string[]; closed: string[] } {
    const open: string[] = [];
    const halfOpen: string[] = [];
    const closed: string[] = [];

    for (const [url, status] of this.statuses) {
      if (status.consecutiveFailures >= 5) {
        open.push(status.endpoint.provider);
      } else if (status.consecutiveFailures >= 2) {
        halfOpen.push(status.endpoint.provider);
      } else {
        closed.push(status.endpoint.provider);
      }
    }

    return { open, halfOpen, closed };
  }

  private classifyError(err: any): string {
    const msg = err.message?.toLowerCase() || '';
    if (msg.includes('429') || msg.includes('rate limit')) return 'rate_limited';
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) return 'timeout';
    if (msg.includes('ECONNREFUSED')) return 'connection_refused';
    if (msg.includes('503') || msg.includes('unavailable')) return 'unavailable';
    if (msg.includes('ENOTFOUND')) return 'dns_failure';
    if (msg.includes('ECONNRESET')) return 'connection_reset';
    if (msg.includes('certificate')) return 'tls_error';
    return 'unknown';
  }

  getStatus(): Map<string, HealthStatus> {
    return new Map(this.statuses);
  }

  /** Export health summary as structured JSON (for /obs-health-check command) */
  getHealthSummary(): object {
    const statuses = [...this.statuses.values()];
    return {
      globalSlotTip: this.globalSlotTip,
      healthyCount: statuses.filter(s => s.healthy).length,
      totalCount: statuses.length,
      endpoints: statuses.map(s => ({
        provider: s.endpoint.provider,
        healthy: s.healthy,
        latencyMs: Math.round(s.latencyMs),
        slot: s.slot,
        behindBy: s.behindBy,
        tier: s.endpoint.tier,
      })),
      circuitBreaker: this.getCircuitBreakerStatus(),
    };
  }
}

class RPCMetrics {
  rpcLatency: Histogram;
  rpcUp: Gauge;
  rpcErrors: Counter;
  slotBehind: Gauge;
  rpcConsecutiveFailures: Gauge;

  constructor(registry: Registry) {
    this.rpcLatency = new Histogram({
      name: 'solana_rpc_request_duration_seconds',
      help: 'RPC request latency in seconds',
      labelNames: ['provider', 'method', 'status'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    });

    this.rpcUp = new Gauge({
      name: 'solana_rpc_up',
      help: '1 if RPC endpoint is healthy, 0 otherwise',
      labelNames: ['provider'],
      registers: [registry],
    });

    this.rpcErrors = new Counter({
      name: 'solana_rpc_errors_total',
      help: 'RPC errors by type',
      labelNames: ['provider', 'error_type'],
      registers: [registry],
    });

    this.slotBehind = new Gauge({
      name: 'solana_rpc_slot_behind',
      help: 'How many slots behind the tip this endpoint is',
      labelNames: ['provider'],
      registers: [registry],
    });

    this.rpcConsecutiveFailures = new Gauge({
      name: 'solana_rpc_consecutive_failures',
      help: 'Consecutive health check failures',
      labelNames: ['provider'],
      registers: [registry],
    });
  }
}
```

## Prometheus Alert Rules for RPC

```yaml
groups:
  - name: solana_rpc_alerts
    rules:
      - alert: RPCEndpointDown
        expr: solana_rpc_up == 0
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "RPC endpoint {{ $labels.provider }} is down"
          runbook: "Check provider status page, verify API key, check rate limits"

      - alert: AllRPCEndpointsDown
        expr: sum(solana_rpc_up) == 0
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "All RPC endpoints are unreachable"
          runbook: "Immediate escalation -- check network, DNS, provider status"

      - alert: RPCHighLatency
        expr: histogram_quantile(0.99, rate(solana_rpc_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "RPC p99 latency > 2s for {{ $labels.provider }}"

      - alert: RPCSlotDrift
        expr: solana_rpc_slot_behind > 10
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.provider }} is {{ $value }} slots behind tip"

      - alert: RPCRateLimited
        expr: rate(solana_rpc_errors_total{error_type="rate_limited"}[5m]) > 0.1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.provider }} is being rate-limited"

      - alert: RPCCircuitBreakerOpen
        expr: solana_rpc_consecutive_failures >= 5
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "Circuit breaker OPEN for {{ $labels.provider }} -- endpoint removed from rotation"
```

## WebSocket Connection Monitoring

```typescript
import { Connection, PublicKey } from '@solana/web3.js';

export class WebSocketMonitor {
  private subscriptions: Map<string, { id: number; lastUpdate: number }> = new Map();
  private staleCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private connection: Connection) {}

  async monitorAccount(pubkey: string, label: string): Promise<number> {
    const subId = this.connection.onAccountChange(
      new PublicKey(pubkey),
      (accountInfo, context) => {
        this.subscriptions.set(label, { id: subId, lastUpdate: Date.now() });
        // Process update...
      },
      'confirmed'
    );
    this.subscriptions.set(label, { id: subId, lastUpdate: Date.now() });
    return subId;
  }

  /** Detect stale subscriptions (no update in expected timeframe) */
  checkStaleSubscriptions(maxAgeMs = 60_000): string[] {
    const stale: string[] = [];
    const now = Date.now();
    for (const [label, sub] of this.subscriptions) {
      if (now - sub.lastUpdate > maxAgeMs) {
        stale.push(label);
      }
    }
    return stale;
  }

  /** Auto-resubscribe stale connections */
  async refreshStaleSubscriptions(maxAgeMs = 60_000): Promise<string[]> {
    const stale = this.checkStaleSubscriptions(maxAgeMs);
    for (const label of stale) {
      const sub = this.subscriptions.get(label);
      if (sub) {
        // Remove old subscription
        await this.connection.removeAccountChangeListener(sub.id);
        this.subscriptions.delete(label);
      }
    }
    return stale; // caller should re-subscribe these
  }

  /** Cleanup all subscriptions */
  async shutdown(): Promise<void> {
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
    }
    for (const [, sub] of this.subscriptions) {
      await this.connection.removeAccountChangeListener(sub.id);
    }
    this.subscriptions.clear();
  }
}
```

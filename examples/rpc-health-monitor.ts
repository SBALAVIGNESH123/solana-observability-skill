/**
 * Solana Observability Skill — Quick Start Example
 * 
 * This example sets up basic RPC health monitoring with automatic failover
 * and Prometheus metrics export for a Solana application.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { Counter, Histogram, Gauge, Registry } from 'prom-client';

// --- Configuration ---

interface RPCEndpoint {
  url: string;
  weight: number;
  region: string;
  provider: string;
}

interface HealthStatus {
  endpoint: string;
  healthy: boolean;
  latencyMs: number;
  blockHeight: number;
  lastChecked: Date;
}

// --- Metrics ---

const registry = new Registry();

const rpcLatency = new Histogram({
  name: 'solana_rpc_request_duration_seconds',
  help: 'RPC request latency in seconds',
  labelNames: ['provider', 'method', 'status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

const rpcHealthGauge = new Gauge({
  name: 'solana_rpc_endpoint_healthy',
  help: 'Whether an RPC endpoint is healthy (1) or not (0)',
  labelNames: ['provider', 'region'],
  registers: [registry],
});

const failoverCounter = new Counter({
  name: 'solana_rpc_failover_total',
  help: 'Number of RPC failover events',
  labelNames: ['from_provider', 'to_provider', 'reason'],
  registers: [registry],
});

// --- Health Monitor ---

export class RPCHealthMonitor {
  private endpoints: RPCEndpoint[];
  private healthMap: Map<string, HealthStatus> = new Map();
  private activeEndpoint: RPCEndpoint;
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(endpoints: RPCEndpoint[]) {
    this.endpoints = endpoints;
    this.activeEndpoint = endpoints[0];
  }

  async start(intervalMs: number = 5000): Promise<void> {
    await this.checkAll();
    this.checkInterval = setInterval(() => this.checkAll(), intervalMs);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private async checkAll(): Promise<void> {
    const results = await Promise.allSettled(
      this.endpoints.map((ep) => this.checkEndpoint(ep))
    );

    for (let i = 0; i < results.length; i++) {
      const ep = this.endpoints[i];
      const result = results[i];

      if (result.status === 'fulfilled') {
        this.healthMap.set(ep.url, result.value);
        rpcHealthGauge.set(
          { provider: ep.provider, region: ep.region },
          result.value.healthy ? 1 : 0
        );
      } else {
        rpcHealthGauge.set(
          { provider: ep.provider, region: ep.region },
          0
        );
      }
    }

    this.maybeFailover();
  }

  private async checkEndpoint(ep: RPCEndpoint): Promise<HealthStatus> {
    const conn = new Connection(ep.url);
    const start = performance.now();

    try {
      const slot = await conn.getSlot();
      const latencyMs = performance.now() - start;

      rpcLatency.observe(
        { provider: ep.provider, method: 'getSlot', status: 'success' },
        latencyMs / 1000
      );

      return {
        endpoint: ep.url,
        healthy: latencyMs < 2000,
        latencyMs,
        blockHeight: slot,
        lastChecked: new Date(),
      };
    } catch (error) {
      const latencyMs = performance.now() - start;
      rpcLatency.observe(
        { provider: ep.provider, method: 'getSlot', status: 'error' },
        latencyMs / 1000
      );

      return {
        endpoint: ep.url,
        healthy: false,
        latencyMs,
        blockHeight: 0,
        lastChecked: new Date(),
      };
    }
  }

  private maybeFailover(): void {
    const currentHealth = this.healthMap.get(this.activeEndpoint.url);

    if (currentHealth && !currentHealth.healthy) {
      const healthy = this.endpoints.find((ep) => {
        const h = this.healthMap.get(ep.url);
        return h && h.healthy;
      });

      if (healthy && healthy.url !== this.activeEndpoint.url) {
        failoverCounter.inc({
          from_provider: this.activeEndpoint.provider,
          to_provider: healthy.provider,
          reason: 'unhealthy',
        });
        this.activeEndpoint = healthy;
      }
    }
  }

  getActiveConnection(): Connection {
    return new Connection(this.activeEndpoint.url);
  }

  getHealthSummary(): Record<string, HealthStatus> {
    return Object.fromEntries(this.healthMap);
  }
}

// --- Usage ---

async function main() {
  const monitor = new RPCHealthMonitor([
    { url: 'https://api.mainnet-beta.solana.com', weight: 1, region: 'us-east', provider: 'solana' },
    { url: process.env.HELIUS_RPC!, weight: 3, region: 'us-east', provider: 'helius' },
    { url: process.env.TRITON_RPC!, weight: 2, region: 'eu-west', provider: 'triton' },
  ]);

  await monitor.start(5000);

  // Use the active (healthy) connection
  const conn = monitor.getActiveConnection();
  const slot = await conn.getSlot();
  console.log(`Current slot: ${slot}`);

  // Expose metrics at /metrics for Prometheus scraping
  // (integrate with your HTTP server)
  const metrics = await registry.metrics();
  console.log(metrics);
}

main().catch(console.error);

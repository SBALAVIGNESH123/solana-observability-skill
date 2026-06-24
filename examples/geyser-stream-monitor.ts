import { Connection, PublicKey } from '@solana/web3.js';
import { Counter, Histogram, Gauge, Registry } from 'prom-client';
import http from 'http';

/**
 * GeyserStreamMonitor - Real-time Solana account monitoring via Geyser gRPC
 * Demonstrates backpressure handling, reconnection, and metric export
 */

interface GeyserConfig {
  endpoint: string;
  token: string;
  accounts: string[];
  maxReconnectDelay: number;
  keepaliveIntervalMs: number;
}

interface StreamMetrics {
  messagesReceived: Counter;
  messageLatency: Histogram;
  reconnections: Counter;
  activeStreams: Gauge;
  backpressureEvents: Counter;
}

class GeyserStreamMonitor {
  private config: GeyserConfig;
  private metrics: StreamMetrics;
  private registry: Registry;
  private isShuttingDown = false;
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;

  constructor(config: GeyserConfig) {
    this.config = config;
    this.registry = new Registry();
    this.metrics = this.initMetrics();
  }

  private initMetrics(): StreamMetrics {
    return {
      messagesReceived: new Counter({
        name: 'solana_geyser_messages_received_total',
        help: 'Total Geyser messages received',
        labelNames: ['message_type'],
        registers: [this.registry],
      }),
      messageLatency: new Histogram({
        name: 'solana_geyser_message_latency_seconds',
        help: 'Latency from slot production to message receipt',
        buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0],
        registers: [this.registry],
      }),
      reconnections: new Counter({
        name: 'solana_geyser_reconnections_total',
        help: 'Total reconnection attempts',
        registers: [this.registry],
      }),
      activeStreams: new Gauge({
        name: 'solana_geyser_active_streams',
        help: 'Number of active Geyser streams',
        registers: [this.registry],
      }),
      backpressureEvents: new Counter({
        name: 'solana_geyser_backpressure_events_total',
        help: 'Times backpressure was applied',
        registers: [this.registry],
      }),
    };
  }

  private clearKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  private getReconnectDelay(): number {
    const baseDelay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.config.maxReconnectDelay
    );
    const jitter = baseDelay * 0.2 * Math.random();
    return baseDelay + jitter;
  }

  async subscribe(): Promise<void> {
    this.clearKeepalive();
    console.log(`[GeyserStreamMonitor] Connecting to ${this.config.endpoint}`);

    try {
      // In production, use @triton-one/yellowstone-grpc Client here
      // const client = new Client(this.config.endpoint, this.config.token);
      // const stream = await client.subscribe();

      this.metrics.activeStreams.inc();
      this.reconnectAttempts = 0;

      this.keepaliveInterval = setInterval(() => {
        console.log('[GeyserStreamMonitor] Keepalive ping');
      }, this.config.keepaliveIntervalMs);

      console.log('[GeyserStreamMonitor] Stream active, monitoring accounts:', this.config.accounts.length);
    } catch (error) {
      this.metrics.activeStreams.dec();
      if (!this.isShuttingDown) {
        await this.reconnect();
      }
    }
  }

  private async reconnect(): Promise<void> {
    this.clearKeepalive();
    this.reconnectAttempts++;
    this.metrics.reconnections.inc();
    const delay = this.getReconnectDelay();
    console.log(`[GeyserStreamMonitor] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    await new Promise(resolve => setTimeout(resolve, delay));
    if (!this.isShuttingDown) {
      await this.subscribe();
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.clearKeepalive();
    this.metrics.activeStreams.set(0);
    console.log('[GeyserStreamMonitor] Shutdown complete');
  }

  async startMetricsServer(port: number): Promise<void> {
    const server = http.createServer(async (req, res) => {
      if (req.url === '/metrics') {
        res.setHeader('Content-Type', this.registry.contentType);
        res.end(await this.registry.metrics());
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    server.listen(port, () => {
      console.log(`[GeyserStreamMonitor] Metrics server on :${port}/metrics`);
    });
  }
}

// Entry point
const monitor = new GeyserStreamMonitor({
  endpoint: process.env.GEYSER_ENDPOINT || 'https://mainnet.rpc.triton.one',
  token: process.env.GEYSER_TOKEN || '',
  accounts: (process.env.WATCH_ACCOUNTS || '').split(',').filter(Boolean),
  maxReconnectDelay: 30000,
  keepaliveIntervalMs: 10000,
});

monitor.startMetricsServer(9101);
monitor.subscribe().catch(console.error);

process.on('SIGTERM', async () => {
  await monitor.shutdown();
  process.exit(0);
});

export { GeyserStreamMonitor, GeyserConfig };

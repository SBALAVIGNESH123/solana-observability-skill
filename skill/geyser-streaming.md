# Geyser gRPC Streaming (Yellowstone)

Real-time on-chain data streaming via Yellowstone gRPC -- the 2026 standard for production Solana observability. Replaces polling with server-push architecture.

## Why Geyser gRPC Over Polling

| Approach | Latency | Throughput | CU Cost | Best For |
|----------|---------|-----------|---------|----------|
| `getSlot()` polling | 400ms+ (slot time) | ~2.5 req/s safe | 0 CU but rate limited | Health checks |
| WebSocket `onAccountChange` | ~400ms | Moderate | 0 CU | Single account watch |
| **Geyser gRPC (Yellowstone)** | **<50ms** | **Unlimited** | **0 CU** | **Production metrics** |

Geyser sits inside the validator -- data arrives before RPC even processes it.

## Architecture

```
+------------------------------------------------------+
| Solana Validator                                      |
|                                                      |
|  AccountsDB --> Geyser Plugin --> gRPC Server        |
|                    |                    |             |
|                    v                    v             |
|              Slot notifications    Account updates    |
|              Transaction results   Program events     |
+------------------------------------------------------+
         |
         v gRPC stream (protobuf, bi-directional)
+------------------------------------------------------+
| Your Observability Pipeline                           |
|                                                      |
|  gRPC Client --> Metrics Parser --> Prometheus       |
|       |                |                             |
|       v                v                             |
|  Reconnect logic   Structured logs --> Loki          |
|  Backpressure      Trace context  --> Tempo/Jaeger   |
+------------------------------------------------------+
```

## Setup: Yellowstone gRPC Client (TypeScript)

```typescript
import Client, {
  CommitmentLevel,
  SubscribeRequestFilterTransactions,
  SubscribeRequestFilterAccounts,
} from '@triton-one/yellowstone-grpc';
import { Counter, Histogram, Gauge, Registry } from 'prom-client';

interface GeyserConfig {
  endpoint: string;        // e.g., 'https://grpc.your-rpc.com:443'
  token: string;           // Auth token from provider
  programIds: string[];    // Programs to monitor
  commitment: CommitmentLevel;
}

export class GeyserObserver {
  private client: Client;
  private config: GeyserConfig;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30_000;
  private metrics: ObservabilityMetrics;
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown = false;

  constructor(config: GeyserConfig, metrics: ObservabilityMetrics) {
    this.config = config;
    this.metrics = metrics;
    this.client = new Client(config.endpoint, config.token, undefined);
  }

  async subscribe(): Promise<void> {
    // Clear any existing keepalive interval from previous connection
    this.clearKeepalive();

    const stream = await this.client.subscribe();

    // Build subscription request
    const request = {
      slots: {
        slotMonitor: { filterByCommitment: true },
      },
      transactions: this.buildTransactionFilters(),
      accounts: this.buildAccountFilters(),
      commitment: this.config.commitment,
      accountsDataSlice: [], // full data
      ping: { id: 1 },      // keepalive
    };

    // Send subscription
    stream.write(request);

    // Handle responses
    stream.on('data', (update) => {
      this.reconnectAttempts = 0; // reset on successful data

      if (update.transaction) {
        this.handleTransaction(update.transaction);
      } else if (update.account) {
        this.handleAccountUpdate(update.account);
      } else if (update.slot) {
        this.handleSlotUpdate(update.slot);
      } else if (update.pong) {
        this.metrics.geyserPingLatency.observe(Date.now() - update.pong.id);
      }
    });

    stream.on('error', (err) => this.handleStreamError(err));
    stream.on('end', () => {
      if (!this.isShuttingDown) {
        this.reconnect();
      }
    });

    // Keepalive ping every 10s -- stored so we can clear on reconnect
    this.startKeepalive(stream);
  }

  /** Graceful shutdown */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.clearKeepalive();
    // Allow in-flight processing to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  private buildTransactionFilters(): Record<string, SubscribeRequestFilterTransactions> {
    const filters: Record<string, SubscribeRequestFilterTransactions> = {};
    for (const programId of this.config.programIds) {
      filters[`program_${programId.slice(0, 8)}`] = {
        vote: false,                    // exclude vote transactions
        failed: true,                   // include failures for error tracking
        accountInclude: [programId],    // only txs touching this program
        accountExclude: [],
        accountRequired: [],
      };
    }
    return filters;
  }

  private buildAccountFilters(): Record<string, SubscribeRequestFilterAccounts> {
    const filters: Record<string, SubscribeRequestFilterAccounts> = {};
    for (const programId of this.config.programIds) {
      filters[`accounts_${programId.slice(0, 8)}`] = {
        account: [],
        owner: [programId],             // all accounts owned by program
        filters: [],
      };
    }
    return filters;
  }

  private handleTransaction(tx: any): void {
    const meta = tx.transaction?.meta;
    if (!meta) return;

    const slot = tx.slot;
    const success = meta.err === null;
    const computeUnitsConsumed = Number(meta.computeUnitsConsumed || 0);
    const program = this.identifyProgram(tx);

    // Record metrics
    this.metrics.transactionTotal.inc({
      program,
      status: success ? 'success' : 'failure',
    });

    this.metrics.computeUnitsUsed.observe(
      { program },
      computeUnitsConsumed
    );

    // Track CU efficiency
    const cuRequested = this.extractComputeBudget(tx);
    if (cuRequested > 0) {
      this.metrics.computeEfficiency.observe(
        { program },
        computeUnitsConsumed / cuRequested
      );
    }

    // Parse program logs for custom events
    if (meta.logMessages) {
      this.parseAndEmitEvents(meta.logMessages, slot);
    }

    // Track priority fees
    const priorityFee = this.extractPriorityFee(tx);
    if (priorityFee > 0) {
      this.metrics.priorityFeeLamports.observe(
        { program },
        priorityFee
      );
    }
  }

  private handleAccountUpdate(update: any): void {
    const pubkey = update.account?.pubkey;
    const lamports = Number(update.account?.lamports || 0);
    const dataLen = update.account?.data?.length || 0;
    const owner = update.account?.owner || 'unknown';

    this.metrics.accountUpdatesTotal.inc({ owner });
    this.metrics.accountBalance.set({ account: pubkey }, lamports / 1e9); // in SOL
    this.metrics.accountDataSize.observe({ owner }, dataLen);
  }

  private handleSlotUpdate(slot: any): void {
    this.metrics.currentSlot.set(Number(slot.slot));
    this.metrics.slotProcessingTime.observe(
      Date.now() / 1000 - Number(slot.slot) * 0.4 // approximate slot time
    );
  }

  private async reconnect(): Promise<void> {
    this.clearKeepalive();
    this.reconnectAttempts++;
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
      this.maxReconnectDelay
    );
    this.metrics.geyserReconnects.inc();
    console.warn(`Geyser stream disconnected. Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    await new Promise(resolve => setTimeout(resolve, delay));
    await this.subscribe();
  }

  private handleStreamError(err: Error): void {
    this.metrics.geyserErrors.inc({ type: err.name || 'UnknownError' });
    console.error('Geyser stream error:', err.message);
  }

  private startKeepalive(stream: any): void {
    this.keepaliveInterval = setInterval(() => {
      try {
        stream.write({ ping: { id: Date.now() } });
      } catch {
        // stream closed -- reconnect will handle it
        this.clearKeepalive();
      }
    }, 10_000);
  }

  private clearKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  private identifyProgram(tx: any): string {
    // Match against monitored program IDs
    for (const programId of this.config.programIds) {
      if (tx.transaction?.transaction?.message?.accountKeys?.includes(programId)) {
        return programId.slice(0, 8);
      }
    }
    return 'unknown';
  }

  private extractComputeBudget(tx: any): number {
    // Parse SetComputeUnitLimit instruction
    const instructions = tx.transaction?.transaction?.message?.instructions || [];
    for (const ix of instructions) {
      if (ix.programId === 'ComputeBudget111111111111111111111111111111') {
        // Data[0] === 2 means SetComputeUnitLimit
        if (ix.data?.[0] === 2 && ix.data.length >= 5) {
          return ix.data[1] | (ix.data[2] << 8) | (ix.data[3] << 16) | (ix.data[4] << 24);
        }
      }
    }
    return 200_000; // default CU limit
  }

  private extractPriorityFee(tx: any): number {
    const instructions = tx.transaction?.transaction?.message?.instructions || [];
    for (const ix of instructions) {
      if (ix.programId === 'ComputeBudget111111111111111111111111111111') {
        // Data[0] === 3 means SetComputeUnitPrice (micro-lamports per CU)
        if (ix.data?.[0] === 3 && ix.data.length >= 9) {
          // Read as little-endian u64
          const view = new DataView(new Uint8Array(ix.data.slice(1, 9)).buffer);
          return Number(view.getBigUint64(0, true));
        }
      }
    }
    return 0;
  }

  private parseAndEmitEvents(logs: string[], slot: number): void {
    for (const log of logs) {
      // Anchor event format: "Program data: <base64>"
      if (log.startsWith('Program data:')) {
        this.metrics.programEventsTotal.inc({ type: 'anchor_event' });
      }
      // Program return format: "Program return: <programId> <base64>"
      if (log.startsWith('Program return:')) {
        this.metrics.programEventsTotal.inc({ type: 'return_data' });
      }
      // Error patterns
      if (log.includes('failed:') || log.includes('Error:')) {
        this.metrics.programErrorsTotal.inc({ slot: String(slot) });
      }
    }
  }
}
```

## Metrics Definition (Prometheus)

```typescript
import { Counter, Histogram, Gauge, Registry } from 'prom-client';

export class ObservabilityMetrics {
  registry: Registry;
  transactionTotal: Counter;
  computeUnitsUsed: Histogram;
  computeEfficiency: Histogram;
  priorityFeeLamports: Histogram;
  accountUpdatesTotal: Counter;
  accountBalance: Gauge;
  accountDataSize: Histogram;
  currentSlot: Gauge;
  slotProcessingTime: Histogram;
  geyserReconnects: Counter;
  geyserErrors: Counter;
  geyserPingLatency: Histogram;
  programEventsTotal: Counter;
  programErrorsTotal: Counter;

  constructor() {
    this.registry = new Registry();

    this.transactionTotal = new Counter({
      name: 'solana_transactions_total',
      help: 'Total transactions processed',
      labelNames: ['program', 'status'],
      registers: [this.registry],
    });

    this.computeUnitsUsed = new Histogram({
      name: 'solana_compute_units_used',
      help: 'Compute units consumed per transaction',
      labelNames: ['program'],
      buckets: [1000, 5000, 10000, 50000, 100000, 200000, 400000, 800000, 1400000],
      registers: [this.registry],
    });

    this.computeEfficiency = new Histogram({
      name: 'solana_compute_efficiency_ratio',
      help: 'Ratio of CU used to CU requested (0-1)',
      labelNames: ['program'],
      buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      registers: [this.registry],
    });

    this.priorityFeeLamports = new Histogram({
      name: 'solana_priority_fee_microlamports',
      help: 'Priority fees in micro-lamports per CU',
      labelNames: ['program'],
      buckets: [0, 100, 500, 1000, 5000, 10000, 50000, 100000, 1000000],
      registers: [this.registry],
    });

    this.accountUpdatesTotal = new Counter({
      name: 'solana_account_updates_total',
      help: 'Total account state changes via Geyser',
      labelNames: ['owner'],
      registers: [this.registry],
    });

    this.accountBalance = new Gauge({
      name: 'solana_account_balance_sol',
      help: 'Account balance in SOL',
      labelNames: ['account'],
      registers: [this.registry],
    });

    this.accountDataSize = new Histogram({
      name: 'solana_account_data_bytes',
      help: 'Account data size in bytes',
      labelNames: ['owner'],
      buckets: [64, 256, 1024, 4096, 10240, 65536],
      registers: [this.registry],
    });

    this.currentSlot = new Gauge({
      name: 'solana_current_slot',
      help: 'Latest processed slot from Geyser',
      registers: [this.registry],
    });

    this.slotProcessingTime = new Histogram({
      name: 'solana_slot_processing_seconds',
      help: 'Time from slot production to processing',
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.geyserReconnects = new Counter({
      name: 'solana_geyser_reconnects_total',
      help: 'Number of Geyser stream reconnections',
      registers: [this.registry],
    });

    this.geyserErrors = new Counter({
      name: 'solana_geyser_errors_total',
      help: 'Geyser stream errors',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.geyserPingLatency = new Histogram({
      name: 'solana_geyser_ping_latency_ms',
      help: 'Geyser keepalive ping round-trip time',
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
      registers: [this.registry],
    });

    this.programEventsTotal = new Counter({
      name: 'solana_program_events_total',
      help: 'Program events emitted',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.programErrorsTotal = new Counter({
      name: 'solana_program_errors_total',
      help: 'Program execution errors',
      labelNames: ['slot'],
      registers: [this.registry],
    });
  }
}
```

## Backpressure & Flow Control

When processing can't keep up with the Geyser stream:

```typescript
class BackpressureHandler {
  private queue: any[] = [];
  private maxQueueSize = 10_000;
  private processing = false;
  private dropCount = 0;
  private metrics: { droppedUpdates: Counter };

  constructor(metrics: { droppedUpdates: Counter }) {
    this.metrics = metrics;
  }

  async enqueue(update: any): Promise<void> {
    if (this.queue.length >= this.maxQueueSize) {
      this.dropCount++;
      this.metrics.droppedUpdates.inc();
      // Drop oldest -- prefer fresh data
      this.queue.shift();
      if (this.dropCount % 1000 === 0) {
        console.warn(`Backpressure: dropped ${this.dropCount} updates total`);
      }
    }
    this.queue.push(update);
    if (!this.processing) {
      await this.drain();
    }
  }

  private async drain(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, 100); // process in batches
      await Promise.allSettled(batch.map(u => this.processUpdate(u)));
    }
    this.processing = false;
  }

  private async processUpdate(update: any): Promise<void> {
    // Your processing logic here
  }

  getStats(): { queueSize: number; totalDropped: number } {
    return { queueSize: this.queue.length, totalDropped: this.dropCount };
  }
}
```

## Multi-Stream Failover (Advanced)

Production deployments should connect to multiple Geyser providers for redundancy:

```typescript
class GeyserFailoverManager {
  private observers: GeyserObserver[] = [];
  private primaryIndex = 0;
  private deduplicationWindow: Map<string, number> = new Map(); // signature -> timestamp
  private readonly DEDUP_TTL_MS = 30_000;

  constructor(configs: GeyserConfig[], metrics: ObservabilityMetrics) {
    for (const config of configs) {
      this.observers.push(new GeyserObserver(config, metrics));
    }
  }

  async startAll(): Promise<void> {
    await Promise.all(this.observers.map(obs => obs.subscribe()));
    // Periodic deduplication window cleanup
    setInterval(() => this.cleanDeduplicationWindow(), 10_000);
  }

  /** Deduplicate events received from multiple streams */
  isDuplicate(signature: string): boolean {
    if (this.deduplicationWindow.has(signature)) {
      return true;
    }
    this.deduplicationWindow.set(signature, Date.now());
    return false;
  }

  private cleanDeduplicationWindow(): void {
    const cutoff = Date.now() - this.DEDUP_TTL_MS;
    for (const [sig, ts] of this.deduplicationWindow) {
      if (ts < cutoff) {
        this.deduplicationWindow.delete(sig);
      }
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.observers.map(obs => obs.shutdown()));
  }
}
```

## Provider Comparison (2026)

| Provider | Geyser gRPC | Price | Latency | Best For |
|----------|-------------|-------|---------|----------|
| Triton (via RPC Pool) | ✅ Yellowstone | $$ | <20ms | Production (premium) |
| Helius | ✅ Enhanced | $$$ | <30ms | DeFi (enhanced webhooks) |
| QuickNode | ✅ Streams | $$ | <30ms | General (good dashboard) |
| Self-hosted validator | ✅ Direct | Server cost | <5ms | Maximum control |
| Chainstack | ✅ | $$ | <40ms | Multi-chain shops |

## Production Deployment Pattern

```yaml
# docker-compose.geyser.yml
services:
  geyser-collector:
    build: ./collector
    environment:
      GEYSER_ENDPOINT: ${GEYSER_ENDPOINT}
      GEYSER_TOKEN: ${GEYSER_TOKEN}
      PROGRAM_IDS: "Program1....,Program2...."
      PROMETHEUS_PORT: "9090"
    ports:
      - "9090:9090"
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '1.0'
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9090/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  prometheus:
    image: prom/prometheus:v2.53.0
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    ports:
      - "9091:9090"

  grafana:
    image: grafana/grafana:11.1.0
    volumes:
      - ./dashboards:/var/lib/grafana/dashboards
      - ./datasources.yml:/etc/grafana/provisioning/datasources/default.yml
    ports:
      - "3000:3000"

volumes:
  prometheus-data:
```

## Common Failure Modes & Mitigations

| Failure | Symptom | Mitigation |
|---------|---------|-----------|
| Token expired | `UNAUTHENTICATED` error | Auto-refresh token, alert on auth failures |
| Provider maintenance | Stream drops, no reconnect | Multi-provider failover, exponential backoff |
| Backpressure overflow | Memory grows, OOM | Queue with drop-oldest policy, metrics on drops |
| Slot skipping | Gap in `currentSlot` gauge | Alert on slot_current - slot_previous > 2 |
| Account filter too broad | Overwhelming data volume | Narrow to specific accounts, not entire programs |
| Network partition | Stale data, no errors | Staleness detection via last-received timestamp |

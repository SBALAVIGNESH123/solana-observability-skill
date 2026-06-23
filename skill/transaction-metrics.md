# Transaction Metrics — Landing Rate, MEV, and Jito Bundles

Complete transaction lifecycle monitoring including Jito bundle tracking, MEV detection, and landing rate optimization.

## Transaction Lifecycle

```
User submits TX
      │
      ▼
┌─────────────────┐
│ RPC receives TX  │ ← Measure: submission latency
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Leader schedules │ ← Measure: queue time (slot-aware)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ TX executes      │ ← Measure: CU used, success/fail
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Confirmed        │ ← Measure: confirmation latency
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Finalized        │ ← Measure: finality time
└─────────────────┘
```

## Landing Rate Tracker

```typescript
import { Connection, TransactionSignature } from '@solana/web3.js';
import { Counter, Histogram, Gauge } from 'prom-client';

interface TxSubmission {
  signature: TransactionSignature;
  submittedAt: number;
  slot: number;
  priority: 'low' | 'medium' | 'high' | 'jito';
}

export class LandingRateTracker {
  private pending: Map<string, TxSubmission> = new Map();
  private readonly maxPendingAge = 120_000; // 2 minutes
  private connection: Connection;

  // Metrics
  private txSubmitted: Counter;
  private txLanded: Counter;
  private txDropped: Counter;
  private txLandingTime: Histogram;
  private landingRate: Gauge;
  private pendingCount: Gauge;

  constructor(connection: Connection, registry: any) {
    this.connection = connection;

    this.txSubmitted = new Counter({
      name: 'solana_tx_submitted_total',
      help: 'Total transactions submitted',
      labelNames: ['priority'],
      registers: [registry],
    });

    this.txLanded = new Counter({
      name: 'solana_tx_landed_total',
      help: 'Total transactions that landed on-chain',
      labelNames: ['priority', 'status'],
      registers: [registry],
    });

    this.txDropped = new Counter({
      name: 'solana_tx_dropped_total',
      help: 'Transactions that expired without landing',
      labelNames: ['priority', 'reason'],
      registers: [registry],
    });

    this.txLandingTime = new Histogram({
      name: 'solana_tx_landing_duration_seconds',
      help: 'Time from submission to on-chain confirmation',
      labelNames: ['priority'],
      buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 90, 120],
      registers: [registry],
    });

    this.landingRate = new Gauge({
      name: 'solana_tx_landing_rate',
      help: 'Rolling landing rate (0-1)',
      labelNames: ['priority'],
      registers: [registry],
    });

    this.pendingCount = new Gauge({
      name: 'solana_tx_pending_count',
      help: 'Currently pending transactions',
      registers: [registry],
    });
  }

  trackSubmission(sig: TransactionSignature, priority: TxSubmission['priority'] = 'medium'): void {
    this.pending.set(sig, {
      signature: sig,
      submittedAt: Date.now(),
      slot: 0,
      priority,
    });
    this.txSubmitted.inc({ priority });
    this.pendingCount.set(this.pending.size);
  }

  async pollConfirmations(): Promise<void> {
    const now = Date.now();
    const expired: string[] = [];
    const toCheck: string[] = [];

    for (const [sig, sub] of this.pending) {
      if (now - sub.submittedAt > this.maxPendingAge) {
        expired.push(sig);
      } else {
        toCheck.push(sig);
      }
    }

    // Mark expired as dropped
    for (const sig of expired) {
      const sub = this.pending.get(sig)!;
      this.txDropped.inc({ priority: sub.priority, reason: 'expired' });
      this.pending.delete(sig);
    }

    // Batch check confirmations (max 256 per call)
    for (let i = 0; i < toCheck.length; i += 256) {
      const batch = toCheck.slice(i, i + 256);
      try {
        const statuses = await this.connection.getSignatureStatuses(batch);
        for (let j = 0; j < batch.length; j++) {
          const status = statuses.value[j];
          if (status) {
            const sub = this.pending.get(batch[j])!;
            const landingTime = (Date.now() - sub.submittedAt) / 1000;
            const success = status.err === null;

            this.txLanded.inc({ priority: sub.priority, status: success ? 'success' : 'failure' });
            this.txLandingTime.observe({ priority: sub.priority }, landingTime);
            this.pending.delete(batch[j]);
          }
        }
      } catch (err) {
        // Rate limited or network error — retry next cycle
      }
    }

    this.pendingCount.set(this.pending.size);
  }
}
```

## Jito Bundle Tracking

```typescript
interface JitoBundleMetrics {
  bundleId: string;
  tipLamports: number;
  txCount: number;
  submittedAt: number;
  landedSlot?: number;
  status: 'pending' | 'landed' | 'dropped';
}

export class JitoObserver {
  private bundles: Map<string, JitoBundleMetrics> = new Map();

  // Prometheus metrics
  private bundleTip: Histogram;
  private bundleLandingRate: Gauge;
  private bundleTxCount: Histogram;
  private mevExtracted: Counter;

  constructor(registry: any) {
    this.bundleTip = new Histogram({
      name: 'solana_jito_bundle_tip_lamports',
      help: 'Jito bundle tip amount in lamports',
      buckets: [1000, 5000, 10000, 50000, 100000, 500000, 1000000, 5000000],
      registers: [registry],
    });

    this.bundleLandingRate = new Gauge({
      name: 'solana_jito_bundle_landing_rate',
      help: 'Jito bundle landing success rate',
      registers: [registry],
    });

    this.bundleTxCount = new Histogram({
      name: 'solana_jito_bundle_tx_count',
      help: 'Transactions per Jito bundle',
      buckets: [1, 2, 3, 4, 5],
      registers: [registry],
    });

    this.mevExtracted = new Counter({
      name: 'solana_mev_extracted_lamports_total',
      help: 'Total MEV extracted (estimated)',
      labelNames: ['type'],  // sandwich, arb, liquidation
      registers: [registry],
    });
  }

  trackBundle(bundleId: string, tipLamports: number, txCount: number): void {
    this.bundles.set(bundleId, {
      bundleId,
      tipLamports,
      txCount,
      submittedAt: Date.now(),
      status: 'pending',
    });
    this.bundleTip.observe(tipLamports);
    this.bundleTxCount.observe(txCount);
  }

  confirmBundle(bundleId: string, slot: number): void {
    const bundle = this.bundles.get(bundleId);
    if (bundle) {
      bundle.status = 'landed';
      bundle.landedSlot = slot;
    }
    this.updateLandingRate();
  }

  private updateLandingRate(): void {
    const recent = [...this.bundles.values()].filter(
      b => Date.now() - b.submittedAt < 300_000 // last 5 min
    );
    if (recent.length === 0) return;
    const landed = recent.filter(b => b.status === 'landed').length;
    this.bundleLandingRate.set(landed / recent.length);
  }
}
```

## Error Classification

```typescript
enum TxErrorType {
  INSUFFICIENT_FUNDS = 'InsufficientFundsForFee',
  ACCOUNT_IN_USE = 'AccountInUse',
  BLOCKHASH_NOT_FOUND = 'BlockhashNotFound',
  PROGRAM_ERROR = 'InstructionError',
  SLOT_SKIPPED = 'SlotSkipped',
  NODE_UNHEALTHY = 'NodeUnhealthy',
  TIMEOUT = 'TransactionExpired',
  SIMULATION_FAILED = 'SimulationFailed',
}

export function classifyTxError(err: any): { type: TxErrorType; retryable: boolean; message: string } {
  const msg = typeof err === 'string' ? err : JSON.stringify(err);

  if (msg.includes('insufficient funds') || msg.includes('InsufficientFundsForFee')) {
    return { type: TxErrorType.INSUFFICIENT_FUNDS, retryable: false, message: 'Wallet has insufficient SOL for fees' };
  }
  if (msg.includes('AccountInUse')) {
    return { type: TxErrorType.ACCOUNT_IN_USE, retryable: true, message: 'Account locked by another transaction' };
  }
  if (msg.includes('BlockhashNotFound') || msg.includes('blockhash not found')) {
    return { type: TxErrorType.BLOCKHASH_NOT_FOUND, retryable: true, message: 'Blockhash expired — refresh and retry' };
  }
  if (msg.includes('InstructionError')) {
    return { type: TxErrorType.PROGRAM_ERROR, retryable: false, message: 'Program execution error' };
  }
  if (msg.includes('SlotSkipped')) {
    return { type: TxErrorType.SLOT_SKIPPED, retryable: true, message: 'Leader skipped slot' };
  }

  return { type: TxErrorType.TIMEOUT, retryable: true, message: `Unknown: ${msg.slice(0, 100)}` };
}
```

## PromQL Recipes — Transaction Metrics

```promql
# Landing rate (5-minute window)
sum(rate(solana_tx_landed_total[5m])) / sum(rate(solana_tx_submitted_total[5m]))

# Average landing time by priority
histogram_quantile(0.95, sum(rate(solana_tx_landing_duration_seconds_bucket[5m])) by (le, priority))

# Error rate by type
sum(rate(solana_tx_dropped_total[5m])) by (reason)

# Jito bundle efficiency (landed vs total)
solana_jito_bundle_landing_rate

# CU utilization distribution
histogram_quantile(0.5, rate(solana_compute_units_used_bucket[5m]))
```

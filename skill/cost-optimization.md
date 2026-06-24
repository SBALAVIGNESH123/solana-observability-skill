# Cost Optimization -- CU Profiling & Priority Fee Strategy

Advanced compute unit optimization and dynamic priority fee management for production Solana programs.

## Why This Matters

| Metric | Impact |
|--------|--------|
| CU over-allocation | Paying for 200k CU when you use 50k = 4x overspend on priority fees |
| Under-allocation | Transaction dropped by scheduler = user-visible failure |
| Static priority fees | Overpay during low congestion, underpay during high congestion |
| No CU profiling | Blind optimization -- can't improve what you can't measure |

## CU Profiler

Profile actual compute unit consumption per instruction path:

```typescript
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { Histogram, Gauge, Registry } from 'prom-client';

interface CUProfile {
  instruction: string;
  samples: number[];
  p50: number;
  p95: number;
  p99: number;
  max: number;
  recommendedLimit: number;
}

export class CUProfiler {
  private profiles: Map<string, number[]> = new Map();
  private metrics: CUMetrics;

  constructor(registry: Registry) {
    this.metrics = new CUMetrics(registry);
  }

  /** Record CU consumption for an instruction type */
  record(instruction: string, cuUsed: number): void {
    const samples = this.profiles.get(instruction) || [];
    samples.push(cuUsed);

    // Keep last 1000 samples (sliding window)
    if (samples.length > 1000) {
      samples.shift();
    }
    this.profiles.set(instruction, samples);

    this.metrics.cuUsed.observe({ instruction }, cuUsed);
  }

  /** Get recommended CU limit for an instruction (p99 + 20% buffer) */
  getRecommendedLimit(instruction: string): number {
    const samples = this.profiles.get(instruction);
    if (!samples || samples.length < 10) {
      return 200_000; // default if insufficient data
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const p99Index = Math.floor(sorted.length * 0.99);
    const p99 = sorted[p99Index];

    // Add 20% buffer over p99
    const recommended = Math.ceil(p99 * 1.2);
    this.metrics.recommendedCU.set({ instruction }, recommended);
    return recommended;
  }

  /** Get full profile for an instruction */
  getProfile(instruction: string): CUProfile | null {
    const samples = this.profiles.get(instruction);
    if (!samples || samples.length === 0) return null;

    const sorted = [...samples].sort((a, b) => a - b);
    return {
      instruction,
      samples: sorted,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      max: sorted[sorted.length - 1],
      recommendedLimit: this.getRecommendedLimit(instruction),
    };
  }

  /** Simulate transaction to get CU without submitting */
  async simulateCU(
    connection: Connection,
    transaction: VersionedTransaction
  ): Promise<{ cuConsumed: number; error: string | null }> {
    const sim = await connection.simulateTransaction(transaction, {
      replaceRecentBlockhash: true,
      sigVerify: false,
    });

    return {
      cuConsumed: sim.value.unitsConsumed || 0,
      error: sim.value.err ? JSON.stringify(sim.value.err) : null,
    };
  }
}

class CUMetrics {
  cuUsed: Histogram;
  recommendedCU: Gauge;

  constructor(registry: Registry) {
    this.cuUsed = new Histogram({
      name: 'solana_cu_consumed_per_instruction',
      help: 'Actual CU consumed per instruction type',
      labelNames: ['instruction'],
      buckets: [1000, 5000, 10000, 25000, 50000, 100000, 200000, 400000],
      registers: [registry],
    });

    this.recommendedCU = new Gauge({
      name: 'solana_cu_recommended_limit',
      help: 'Recommended CU limit per instruction (p99 + buffer)',
      labelNames: ['instruction'],
      registers: [registry],
    });
  }
}
```

## Dynamic Priority Fee Strategy

Adapt priority fees based on network conditions in real-time:

```typescript
import { Connection } from '@solana/web3.js';
import { Gauge, Histogram, Registry } from 'prom-client';

interface FeeStrategy {
  level: 'low' | 'medium' | 'high' | 'urgent';
  microLamportsPerCU: number;
  maxLamports: number;
}

export class PriorityFeeManager {
  private recentFees: number[] = [];
  private readonly SAMPLE_WINDOW = 50; // last 50 slots
  private metrics: FeeMetrics;

  constructor(registry: Registry) {
    this.metrics = new FeeMetrics(registry);
  }

  /** Fetch recent priority fees from the network */
  async updateFeeData(connection: Connection, programId?: string): Promise<void> {
    const accounts = programId ? [programId] : undefined;

    const feeEstimate = await connection.getRecentPrioritizationFees(
      accounts ? accounts.map(a => new (await import('@solana/web3.js')).PublicKey(a)) : undefined
    );

    // Extract non-zero fees from recent slots
    const fees = feeEstimate
      .filter(f => f.prioritizationFee > 0)
      .map(f => f.prioritizationFee);

    this.recentFees = fees.slice(-this.SAMPLE_WINDOW);

    // Update metrics
    if (this.recentFees.length > 0) {
      const sorted = [...this.recentFees].sort((a, b) => a - b);
      this.metrics.networkFeeP50.set(sorted[Math.floor(sorted.length * 0.5)] || 0);
      this.metrics.networkFeeP75.set(sorted[Math.floor(sorted.length * 0.75)] || 0);
      this.metrics.networkFeeP90.set(sorted[Math.floor(sorted.length * 0.9)] || 0);
    }
  }

  /** Get recommended fee based on urgency level */
  getRecommendedFee(level: FeeStrategy['level'] = 'medium'): FeeStrategy {
    const sorted = [...this.recentFees].sort((a, b) => a - b);
    const len = sorted.length;

    if (len === 0) {
      // No data -- use conservative defaults
      const defaults: Record<string, FeeStrategy> = {
        low: { level: 'low', microLamportsPerCU: 100, maxLamports: 10_000 },
        medium: { level: 'medium', microLamportsPerCU: 1_000, maxLamports: 50_000 },
        high: { level: 'high', microLamportsPerCU: 10_000, maxLamports: 500_000 },
        urgent: { level: 'urgent', microLamportsPerCU: 100_000, maxLamports: 5_000_000 },
      };
      return defaults[level];
    }

    // Percentile-based fee selection
    const percentiles: Record<string, number> = {
      low: 0.25,      // 25th percentile -- cheaper, might be slow
      medium: 0.50,   // 50th percentile -- balanced
      high: 0.75,     // 75th percentile -- faster confirmation
      urgent: 0.95,   // 95th percentile -- near-guaranteed next slot
    };

    const index = Math.floor(len * percentiles[level]);
    const fee = sorted[Math.min(index, len - 1)];

    return {
      level,
      microLamportsPerCU: fee,
      maxLamports: fee * 200_000, // max based on default CU limit
    };
  }

  /** Cost estimate for a transaction */
  estimateCost(cuLimit: number, level: FeeStrategy['level'] = 'medium'): {
    priorityFeeLamports: number;
    baseFeelamports: number;
    totalLamports: number;
    totalSOL: number;
  } {
    const strategy = this.getRecommendedFee(level);
    const priorityFeeLamports = Math.ceil((strategy.microLamportsPerCU * cuLimit) / 1_000_000);
    const baseFeelamports = 5000; // standard base fee

    return {
      priorityFeeLamports,
      baseFeelamports,
      totalLamports: priorityFeeLamports + baseFeelamports,
      totalSOL: (priorityFeeLamports + baseFeelamports) / 1e9,
    };
  }
}

class FeeMetrics {
  networkFeeP50: Gauge;
  networkFeeP75: Gauge;
  networkFeeP90: Gauge;

  constructor(registry: Registry) {
    this.networkFeeP50 = new Gauge({
      name: 'solana_priority_fee_p50_microlamports',
      help: 'Network-wide p50 priority fee',
      registers: [registry],
    });
    this.networkFeeP75 = new Gauge({
      name: 'solana_priority_fee_p75_microlamports',
      help: 'Network-wide p75 priority fee',
      registers: [registry],
    });
    this.networkFeeP90 = new Gauge({
      name: 'solana_priority_fee_p90_microlamports',
      help: 'Network-wide p90 priority fee',
      registers: [registry],
    });
  }
}
```

## CU Savings Dashboard (PromQL)

```promql
# CU waste ratio (requested - used) / requested
1 - (
  rate(solana_cu_consumed_per_instruction_sum[5m])
  /
  rate(solana_cu_consumed_per_instruction_count[5m])
) / on(instruction) solana_cu_recommended_limit

# Priority fee cost per hour in SOL
sum(rate(solana_priority_fee_microlamports_sum[1h])) / 1e6 / 1e9

# Potential savings if using dynamic fees vs static
(solana_priority_fee_static_cost - solana_priority_fee_dynamic_cost) / solana_priority_fee_static_cost
```

## Prometheus Alerts -- Cost

```yaml
groups:
  - name: solana_cost_alerts
    rules:
      - alert: CUOverAllocation
        expr: |
          (solana_cu_recommended_limit - avg_over_time(solana_cu_consumed_per_instruction_sum[1h]) 
          / avg_over_time(solana_cu_consumed_per_instruction_count[1h]))
          / solana_cu_recommended_limit > 0.5
        for: 30m
        labels:
          severity: info
        annotations:
          summary: "Instruction {{ $labels.instruction }} is using <50% of allocated CU -- reduce limit to save fees"

      - alert: HighPriorityFeeSpend
        expr: sum(rate(solana_priority_fee_microlamports_sum[1h])) / 1e6 / 1e9 > 0.1
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "Spending >0.1 SOL/hour on priority fees -- review fee strategy"
```

# Program Instrumentation -- IDL-Aware CU Profiling & Anchor Events

Instrument Solana programs for observability: Anchor event parsing, CU profiling, Geyser-based metric extraction, and IDL-aware auto-parsing.

## Anchor Event Parsing

Anchor programs emit events via `emit!()` macro. These are base64-encoded in transaction logs with the prefix `Program data:`.

```typescript
import { BorshCoder, EventParser, Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { Counter, Histogram } from 'prom-client';

export class AnchorEventCollector {
  private parser: EventParser;
  private eventCounter: Counter;
  private eventLatency: Histogram;

  constructor(idl: Idl, programId: PublicKey, registry: any) {
    const coder = new BorshCoder(idl);
    this.parser = new EventParser(programId, coder);

    this.eventCounter = new Counter({
      name: 'solana_program_events_total',
      help: 'Anchor events emitted by the program',
      labelNames: ['event_name', 'program'],
      registers: [registry],
    });

    this.eventLatency = new Histogram({
      name: 'solana_program_event_processing_seconds',
      help: 'Time to parse and process program events',
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
      registers: [registry],
    });
  }

  parseTransactionLogs(logs: string[], programId: string): ParsedEvent[] {
    const start = performance.now();
    const events: ParsedEvent[] = [];

    for (const event of this.parser.parseLogs(logs)) {
      events.push({ name: event.name, data: event.data });
      this.eventCounter.inc({ event_name: event.name, program: programId.slice(0, 8) });
    }

    this.eventLatency.observe((performance.now() - start) / 1000);
    return events;
  }
}

interface ParsedEvent {
  name: string;
  data: any;
}
```

## Compute Unit Profiling

```typescript
export class CUProfiler {
  private cuUsed: Histogram;
  private cuEfficiency: Histogram;
  private cuByInstruction: Histogram;

  constructor(registry: any) {
    this.cuUsed = new Histogram({
      name: 'solana_program_cu_used',
      help: 'Compute units consumed per transaction',
      labelNames: ['instruction', 'program'],
      buckets: [1000, 5000, 10000, 25000, 50000, 100000, 200000, 400000, 800000, 1400000],
      registers: [registry],
    });

    this.cuEfficiency = new Histogram({
      name: 'solana_program_cu_efficiency',
      help: 'CU used / CU requested ratio (lower = wasted budget)',
      labelNames: ['program'],
      buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      registers: [registry],
    });

    this.cuByInstruction = new Histogram({
      name: 'solana_program_cu_per_instruction',
      help: 'CU consumed by specific instruction types',
      labelNames: ['instruction'],
      buckets: [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000],
      registers: [registry],
    });
  }

  recordTransaction(meta: {
    computeUnitsConsumed: number;
    computeUnitsRequested: number;
    instructions: { name: string; cuConsumed: number }[];
    program: string;
  }): void {
    this.cuUsed.observe(
      { instruction: 'total', program: meta.program },
      meta.computeUnitsConsumed
    );

    if (meta.computeUnitsRequested > 0) {
      this.cuEfficiency.observe(
        { program: meta.program },
        meta.computeUnitsConsumed / meta.computeUnitsRequested
      );
    }

    for (const ix of meta.instructions) {
      this.cuByInstruction.observe({ instruction: ix.name }, ix.cuConsumed);
    }
  }
}
```

## CU Estimation from Logs

Transaction logs contain CU consumption data. Parse it:

```typescript
export function parseCUFromLogs(logs: string[]): { total: number; byProgram: Map<string, number> } {
  let total = 0;
  const byProgram = new Map<string, number>();
  let currentProgram = '';

  for (const log of logs) {
    // "Program <pubkey> invoke [1]" -- top-level invoke
    const invokeMatch = log.match(/^Program (\w+) invoke \[(\d+)\]/);
    if (invokeMatch && invokeMatch[2] === '1') {
      currentProgram = invokeMatch[1];
    }

    // "Program <pubkey> consumed 12345 of 200000 compute units"
    const cuMatch = log.match(/^Program (\w+) consumed (\d+) of (\d+) compute units/);
    if (cuMatch) {
      const consumed = parseInt(cuMatch[2], 10);
      total = consumed; // last one wins (cumulative)
      byProgram.set(cuMatch[1], consumed);
    }
  }

  return { total, byProgram };
}
```

## Geyser Plugin for Custom Metrics (Rust)

For validators running custom Geyser plugins:

```rust
use solana_geyser_plugin_interface::geyser_plugin_interface::{
    GeyserPlugin, GeyserPluginError, ReplicaAccountInfoVersions,
    ReplicaTransactionInfoVersions, Result as PluginResult,
};
use prometheus::{Counter, Histogram, Registry, opts, histogram_opts};

pub struct ObservabilityPlugin {
    tx_counter: Counter,
    cu_histogram: Histogram,
    registry: Registry,
}

impl GeyserPlugin for ObservabilityPlugin {
    fn name(&self) -> &'static str {
        "solana-observability-plugin"
    }

    fn notify_transaction(
        &self,
        transaction: ReplicaTransactionInfoVersions,
        slot: u64,
    ) -> PluginResult<()> {
        match transaction {
            ReplicaTransactionInfoVersions::V0_0_2(info) => {
                self.tx_counter.inc();
                if let Some(meta) = &info.transaction_status_meta {
                    self.cu_histogram.observe(meta.compute_units_consumed.unwrap_or(0) as f64);
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn account_data_notifications_enabled(&self) -> bool {
        true
    }

    fn transaction_notifications_enabled(&self) -> bool {
        true
    }
}
```

## IDL-Aware Auto-Instrumentation

Given an Anchor IDL, automatically generate metrics for all instructions:

```typescript
import { Idl } from '@coral-xyz/anchor';

export function generateMetricsFromIDL(idl: Idl, registry: any): Map<string, Histogram> {
  const metrics = new Map<string, Histogram>();

  for (const instruction of idl.instructions) {
    const metric = new Histogram({
      name: `solana_${idl.name}_${instruction.name}_cu`,
      help: `CU consumed by ${idl.name}.${instruction.name}`,
      buckets: [1000, 5000, 10000, 50000, 100000, 200000],
      registers: [registry],
    });
    metrics.set(instruction.name, metric);
  }

  return metrics;
}
```

# Distributed Tracing -- Full OpenTelemetry Pipeline for Solana

End-to-end request tracing from user action through RPC, program execution, and backend services.

## Architecture

```
User Action -> Frontend SDK (span start)
      |
      v
RPC Request -> (trace context in headers)
      |
      v
Transaction Submit -> (signature as span attribute)
      |
      v
Program Execution -> (CU, logs as span events)
      |
      v
Confirmation -> (span end, duration recorded)
      |
      v
OpenTelemetry Collector -> Tempo/Jaeger -> Grafana
```

## TypeScript OTel Setup

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { trace, SpanStatusCode, context, propagation } from '@opentelemetry/api';

// Initialize SDK
const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'solana-app',
    [ATTR_SERVICE_VERSION]: '1.0.0',
    'deployment.environment': process.env.NODE_ENV || 'development',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/metrics',
    }),
    exportIntervalMillis: 15000,
  }),
});

sdk.start();

// Tracer for Solana operations
const tracer = trace.getTracer('solana-operations', '1.0.0');

export async function tracedTransaction(
  connection: any,
  transaction: any,
  signers: any[],
  opts?: { label?: string; priority?: string }
): Promise<string> {
  return tracer.startActiveSpan(`solana.transaction.${opts?.label || 'unknown'}`, async (span) => {
    try {
      // Add Solana-specific attributes
      span.setAttribute('solana.priority', opts?.priority || 'medium');
      span.setAttribute('solana.signer_count', signers.length);

      // Submit
      span.addEvent('transaction.submit');
      const signature = await connection.sendTransaction(transaction, signers);
      span.setAttribute('solana.signature', signature);

      // Confirm
      span.addEvent('transaction.confirming');
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: JSON.stringify(confirmation.value.err) });
        span.setAttribute('solana.error', JSON.stringify(confirmation.value.err));
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.addEvent('transaction.confirmed', {
        'solana.slot': confirmation.context?.slot || 0,
      });

      return signature;
    } catch (err: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}
```

## OTel Collector Configuration

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1024

  attributes:
    actions:
      - key: solana.network
        value: mainnet-beta
        action: upsert

  tail_sampling:
    decision_wait: 10s
    policies:
      - name: errors-always
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: slow-traces
        type: latency
        latency: { threshold_ms: 5000 }
      - name: probabilistic-sample
        type: probabilistic
        probabilistic: { sampling_percentage: 10 }

exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls:
      insecure: true

  prometheus:
    endpoint: 0.0.0.0:8889
    namespace: solana

  loki:
    endpoint: http://loki:3100/loki/api/v1/push
    labels:
      attributes:
        service.name: "service_name"
        solana.signature: "signature"

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, attributes, tail_sampling]
      exporters: [otlp/tempo]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
```

## Trace Context Propagation

When calling multiple services (e.g., backend -> RPC -> indexer), propagate trace context:

```typescript
import { context, propagation } from '@opentelemetry/api';

// Inject trace context into outgoing HTTP headers
function injectTraceContext(headers: Record<string, string>): void {
  propagation.inject(context.active(), headers);
}

// Extract trace context from incoming request
function extractTraceContext(headers: Record<string, string>): any {
  return propagation.extract(context.active(), headers);
}
```

## Correlation: Traces <-> Logs <-> Metrics

Link all three signals using trace ID with **pino** (production-grade Node.js logger):

```typescript
import { trace } from '@opentelemetry/api';
import pino from 'pino';

// Create a pino logger with trace context injection
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    log(obj) {
      // Automatically attach trace context to every log line
      const span = trace.getActiveSpan();
      if (span) {
        const ctx = span.spanContext();
        return {
          ...obj,
          trace_id: ctx.traceId,
          span_id: ctx.spanId,
          trace_flags: ctx.traceFlags,
        };
      }
      return obj;
    },
  },
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty' }
    : undefined,
});

// Usage in your Solana app:
export function getLogger(module: string) {
  return logger.child({ module });
}

// Example:
// const log = getLogger('transaction-monitor');
// log.info({ signature, slot }, 'Transaction confirmed');
// -> Automatically includes trace_id and span_id for Grafana correlation
```

## Custom Span Attributes for Solana

Define a standard set of Solana-specific span attributes for team consistency:

```typescript
// solana-semantic-conventions.ts
export const SolanaAttributes = {
  // Transaction attributes
  SOLANA_SIGNATURE: 'solana.signature',
  SOLANA_SLOT: 'solana.slot',
  SOLANA_BLOCK_TIME: 'solana.block_time',
  SOLANA_COMPUTE_UNITS: 'solana.compute_units',
  SOLANA_FEE_LAMPORTS: 'solana.fee_lamports',
  SOLANA_PRIORITY_FEE: 'solana.priority_fee_microlamports',

  // Program attributes
  SOLANA_PROGRAM_ID: 'solana.program_id',
  SOLANA_INSTRUCTION: 'solana.instruction',
  SOLANA_ERROR_CODE: 'solana.error_code',

  // Network attributes
  SOLANA_NETWORK: 'solana.network',          // mainnet-beta, devnet, testnet
  SOLANA_RPC_PROVIDER: 'solana.rpc_provider',
  SOLANA_COMMITMENT: 'solana.commitment',    // processed, confirmed, finalized

  // DeFi-specific
  SOLANA_TOKEN_MINT: 'solana.token_mint',
  SOLANA_AMOUNT_LAMPORTS: 'solana.amount_lamports',
  SOLANA_POOL_ADDRESS: 'solana.pool_address',
} as const;
```

## Grafana Dashboard: Trace Explorer Query

```
// Tempo query for failed Solana transactions
{ span.solana.error != "" && resource.service.name = "solana-app" }

// Find slow transactions (>5s confirmation)
{ name =~ "solana.transaction.*" && duration > 5s }

// Trace a specific signature
{ span.solana.signature = "5wHu1qw..." }
```

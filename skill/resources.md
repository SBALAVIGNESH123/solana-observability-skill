# Resources & SDK Reference

## Core Dependencies

| Package | Purpose | Install |
|---------|---------|---------|
| `@solana/web3.js` | Solana RPC client | `npm i @solana/web3.js` |
| `@triton-one/yellowstone-grpc` | Geyser gRPC streaming | `npm i @triton-one/yellowstone-grpc` |
| `@coral-xyz/anchor` | Anchor IDL + event parsing | `npm i @coral-xyz/anchor` |
| `prom-client` | Prometheus metrics (Node.js) | `npm i prom-client` |
| `@opentelemetry/sdk-node` | OpenTelemetry tracing | `npm i @opentelemetry/sdk-node` |
| `@opentelemetry/exporter-trace-otlp-http` | OTLP exporter | `npm i @opentelemetry/exporter-trace-otlp-http` |

## Python Dependencies

| Package | Purpose | Install |
|---------|---------|---------|
| `solana` | Solana RPC client (Python) | `pip install solana` |
| `prometheus-client` | Prometheus metrics | `pip install prometheus-client` |
| `structlog` | Structured logging | `pip install structlog` |
| `opentelemetry-sdk` | OTel tracing | `pip install opentelemetry-sdk` |
| `opentelemetry-exporter-otlp` | OTLP exporter | `pip install opentelemetry-exporter-otlp` |

## Infrastructure Tools

| Tool | Purpose | Link |
|------|---------|------|
| Prometheus | Metrics storage + alerting | [prometheus.io](https://prometheus.io) |
| Grafana | Visualization + dashboards | [grafana.com](https://grafana.com) |
| Loki | Log aggregation | [grafana.com/loki](https://grafana.com/oss/loki/) |
| Tempo | Distributed tracing backend | [grafana.com/tempo](https://grafana.com/oss/tempo/) |
| Alertmanager | Alert routing + dedup | [prometheus.io/alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) |
| OpenTelemetry Collector | Telemetry pipeline | [opentelemetry.io](https://opentelemetry.io/docs/collector/) |

## RPC Providers with Geyser gRPC Support

| Provider | Geyser gRPC | Free Tier | Documentation |
|----------|-------------|-----------|---------------|
| Helius | ✅ Enhanced | 100K credits/mo | [docs.helius.dev](https://docs.helius.dev) |
| Triton (RPC Pool) | ✅ Yellowstone | No | [triton.one](https://triton.one) |
| QuickNode | ✅ Streams | 10M API credits | [quicknode.com/docs](https://www.quicknode.com/docs) |
| Chainstack | ✅ | 3M requests/mo | [chainstack.com/docs](https://docs.chainstack.com) |

## Solana-Specific Observability Resources

| Resource | What It Covers |
|----------|---------------|
| [Solana Validator Docs](https://docs.solanalabs.com/operations) | Validator operations + monitoring |
| [Helius Enhanced API](https://docs.helius.dev/solana-apis/enhanced-transactions-api) | Transaction parsing helpers |
| [Jito Labs Docs](https://jito-labs.gitbook.io/mev) | MEV + bundle documentation |
| [Anchor Book](https://www.anchor-lang.com) | Program development + events |
| [Solana Cookbook](https://solanacookbook.com) | General Solana patterns |

## Community Dashboards & Templates

| Template | Source |
|----------|--------|
| Solana Validator Metrics | [solana-labs/solana/metrics](https://github.com/solana-labs/solana/tree/master/metrics) |
| StakeWiz Validator Dashboard | [stakewiz.com](https://stakewiz.com) |
| Validators.app | [validators.app](https://validators.app) |

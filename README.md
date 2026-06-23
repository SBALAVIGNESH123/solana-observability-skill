# solana-observability-skill

Production-grade observability for Solana programs, validators, and infrastructure. A skill for the [Solana AI Kit](https://github.com/solanabr/solana-ai-kit).

## What It Solves

Every Solana builder eventually asks: "Why did my transaction fail?" / "Why is latency spiking?" / "Is my program being exploited?" — but there's no unified, production-grade observability solution for Solana.

This skill gives AI coding agents (Claude Code, Codex) the knowledge to set up complete monitoring stacks covering:

- **RPC health monitoring** with QoS-aware failover and stake-weighted routing
- **Geyser gRPC (Yellowstone)** streaming for real-time metrics (<50ms latency)
- **Transaction lifecycle tracking** with landing rate, Jito bundle, and MEV monitoring
- **Validator performance** — vote latency, skip rate, credit differential, delinquency
- **Security monitoring** — authority changes, large drains, exploit pattern detection
- **SLO-based alerting** with multi-window burn rates (Google SRE methodology)
- **Program instrumentation** — CU profiling, Anchor event parsing, IDL-aware metrics
- **Distributed tracing** — full OpenTelemetry pipeline with trace↔log↔metric correlation
- **Grafana dashboards** — dashboard-as-code with Terraform provisioning

## Install

```bash
# One-command install into Solana AI Kit
curl -fsSL https://raw.githubusercontent.com/SBALAVIGNESH123/solana-observability-skill/main/install.sh | bash

# Or with auto-confirm
curl -fsSL https://raw.githubusercontent.com/SBALAVIGNESH123/solana-observability-skill/main/install.sh | bash -s -- -y
```

## Structure

```
solana-observability-skill/
├── skill/
│   ├── SKILL.md                    # Entry point — progressive routing
│   ├── geyser-streaming.md         # Yellowstone gRPC real-time streaming
│   ├── rpc-monitoring.md           # Multi-provider health + failover
│   ├── transaction-metrics.md      # Landing rate, MEV, Jito bundles
│   ├── validator-monitoring.md     # Vote latency, skip rate, delinquency
│   ├── security-monitoring.md      # Exploit detection, authority alerts
│   ├── alerting-slo.md             # Multi-window burn rates, PagerDuty
│   ├── program-instrumentation.md  # CU profiling, Anchor events, Geyser plugin
│   ├── dashboards.md               # Grafana + Terraform + Docker Compose
│   ├── distributed-tracing.md      # Full OTel pipeline
│   └── resources.md                # SDK reference + tool links
├── agents/
│   ├── observability-architect.md  # Designs full monitoring stacks
│   ├── incident-responder.md       # Guides through active incidents
│   └── metrics-engineer.md         # Implements specific metrics/alerts
├── commands/
│   ├── health-check.md             # /obs-health-check
│   ├── dashboard-gen.md            # /obs-dashboard-gen
│   └── alert-audit.md              # /obs-alert-audit
├── rules/
│   ├── metrics-naming.md           # Enforced naming conventions
│   └── observability-patterns.md   # Code generation best practices
├── CLAUDE.md                       # Claude Code configuration
├── LICENSE                         # MIT
├── README.md                       # This file
└── install.sh                      # Installer script
```

## Key Features

| Feature | What No One Else Has |
|---------|---------------------|
| Geyser gRPC streaming | Real-time metrics at <50ms, not 400ms polling |
| Multi-window SLO burn rates | Google SRE methodology adapted for Solana |
| Security monitoring | Authority change + drain detection in real-time |
| Validator monitoring | Full validator health for operators |
| IDL-aware instrumentation | Auto-generates metrics from Anchor IDL |
| Cross-domain | Works for DeFi, NFT, gaming, payments, validators |

## License

MIT

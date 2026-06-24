# solana-observability-skill

> Production-grade observability for Solana programs, validators, and infrastructure.
> A skill for the [Solana AI Kit](https://github.com/solanabr/solana-ai-kit).

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Solana AI Kit](https://img.shields.io/badge/Solana_AI_Kit-compatible-blueviolet)](https://github.com/solanabr/solana-ai-kit)
[![Version](https://img.shields.io/badge/version-2.0.0-blue)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](tsconfig.json)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green?logo=node.js)](package.json)

---

## Architecture

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    Your Solana Program / Validator                â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
             â”‚                      â”‚                 â”‚
     â”Œâ”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”   â”Œâ”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
     â”‚  RPC Monitor  â”‚    â”‚  Geyser gRPC    â”‚   â”‚  Security Mon  â”‚
     â”‚  (failover +  â”‚    â”‚  (Yellowstone   â”‚   â”‚  (authority +  â”‚
     â”‚   circuit brk)â”‚    â”‚   <50ms stream) â”‚   â”‚   drain detect)â”‚
     â””â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â””â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
             â”‚                     â”‚                 â”‚
     â”Œâ”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
     â”‚              Prometheus + OpenTelemetry Collector           â”‚
     â”‚         (metrics, traces, logs â€” unified pipeline)         â”‚
     â””â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
             â”‚                     â”‚                 â”‚
     â”Œâ”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”   â”Œâ”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
     â”‚   Grafana     â”‚    â”‚  PagerDuty /  â”‚   â”‚  SLO Burn Rate â”‚
     â”‚  Dashboards   â”‚    â”‚  Slack Alerts â”‚   â”‚  Engine        â”‚
     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## The Problem

Every Solana builder eventually hits these walls:

- **"Why did my transaction fail?"** â€” No clear lifecycle tracking from send â†’ land â†’ confirm
- **"Why is latency spiking?"** â€” No RPC health visibility across providers
- **"Is my program being exploited?"** â€” No real-time authority/drain detection
- **"Whatâ€™s my validator doing?"** â€” No unified skip rate / vote latency dashboard
- **"Am I overpaying for priority fees?"** â€” No CU profiling or cost optimization

Thereâ€™s no unified, production-grade observability solution for Solana. Builders cobble together ad-hoc scripts every time. This skill fixes that â€” permanently.

---

## What This Skill Does

This skill gives AI coding agents (Claude Code, Codex) the knowledge to design, deploy, and maintain **complete monitoring stacks** for any Solana application:

| Capability | What It Delivers |
|-----------|-----------------|
| **RPC Health Monitoring** | QoS-aware failover, circuit breakers, stake-weighted routing |
| **Geyser gRPC Streaming** | Yellowstone real-time metrics at <50ms (not 400ms polling) |
| **Transaction Metrics** | Landing rate tracking, Jito bundle monitoring, MEV detection |
| **Validator Monitoring** | Vote latency, skip rate, credit differential, delinquency alerts |
| **Security Monitoring** | Authority changes, large drains, flash loans, exploit patterns |
| **SLO-Based Alerting** | Multi-window burn rates (Google SRE methodology for Solana) |
| **Program Instrumentation** | CU profiling, Anchor event parsing, IDL-aware auto-metrics |
| **Distributed Tracing** | Full OpenTelemetry pipeline with traceâ†”logâ†”metric correlation |
| **Grafana Dashboards** | Dashboard-as-code with Terraform provisioning |
| **Cost Optimization** | Dynamic priority fees, CU simulation, savings tracking |
| **Chaos Testing** | Resilience verification, CI/CD integration, failure injection |

---

## Quick Start Demo

The `deploy/` directory contains a **fully working** monitoring stack you can spin up in 60 seconds:

```bash
# Clone the repo
git clone https://github.com/SBALAVIGNESH123/solana-observability-skill.git
cd solana-observability-skill

# Start the full stack (Prometheus + Grafana + Solana exporter)
cd deploy && docker compose up -d

# Access:
#   Grafana:    http://localhost:3000 (admin / solana-obs)
#   Prometheus: http://localhost:9090
#   Exporter:   http://localhost:9100/metrics
```

**Whatâ€™s included in the demo:**
- Pre-configured Prometheus scraping Solana RPC health metrics
- Grafana dashboard auto-provisioned with 8 panels (RPC health, landing rate, circuit breaker, security alerts, validator skip rate, SLO burn rate)
- Real alert rules for RPC down, high latency, low landing rate, security incidents, validator delinquency, and SLO burn
- A working Node.js exporter that monitors Solana mainnet RPC

**Verify it works:**
```bash
# Run the smoke test
bash scripts/smoke-test.sh

# Or with full deploy verification
bash scripts/smoke-test.sh --deploy --cleanup
```

---


---

## Deployment Proof

The deploy stack runs locally with `docker compose up -d`:

### Grafana Dashboard (8 panels auto-provisioned)

![Grafana Dashboard](docs/images/grafana-dashboard.png)

*All 8 panels load automatically: RPC Health, Transaction Landing Rate, Circuit Breaker, Security Alerts, RPC Latency (p95), Transactions Sent vs Landed, Validator Skip Rate, SLO Error Budget.*

### Prometheus Metrics Engine

![Prometheus UI](docs/images/prometheus-ui.png)

*Prometheus running at localhost:9090 with all scrape configs and 12 alert rules loaded.*

> Both services start in under 10 seconds. No data shown because no live Solana RPC is connected - the infrastructure itself is fully operational and ready for production use.

---

## Install (AI Kit Skill)

```bash
# One-command install into Solana AI Kit
curl -fsSL https://raw.githubusercontent.com/SBALAVIGNESH123/solana-observability-skill/main/install.sh | bash

# Or with auto-confirm (CI/CD)
curl -fsSL https://raw.githubusercontent.com/SBALAVIGNESH123/solana-observability-skill/main/install.sh | bash -s -- -y
```

**What the installer does:**
1. Checks for `git` availability
2. Clones into `.solana-ai-kit/skills/solana-observability-skill/`
3. Supports re-run for updates (`git pull --ff-only`)
4. Respects `-y` flag for automated environments

---

## Structure

```
solana-observability-skill/
â”œâ”€â”€ skill/
â”‚   â”œâ”€â”€ SKILL.md                    # Entry point â€” progressive routing (12 files)
â”‚   â”œâ”€â”€ rpc-monitoring.md           # Multi-provider health + circuit breakers
â”‚   â”œâ”€â”€ geyser-streaming.md         # Yellowstone gRPC + failover manager
â”‚   â”œâ”€â”€ transaction-metrics.md      # Landing rate, MEV, Jito bundles
â”‚   â”œâ”€â”€ validator-monitoring.md     # Vote latency, skip rate, delinquency
â”‚   â”œâ”€â”€ security-monitoring.md      # Exploit detection, drain alerts, flash loans
â”‚   â”œâ”€â”€ alerting-slo.md             # Multi-window burn rates, PagerDuty/Slack
â”‚   â”œâ”€â”€ program-instrumentation.md  # CU profiling, Anchor events, Geyser plugin (Rust)
â”‚   â”œâ”€â”€ dashboards.md               # Grafana + Terraform + Docker Compose
â”‚   â”œâ”€â”€ distributed-tracing.md      # Full OTel pipeline, pino structured logging
â”‚   â”œâ”€â”€ cost-optimization.md        # CU profiler, dynamic priority fees, simulation
â”‚   â”œâ”€â”€ chaos-testing.md            # Resilience framework, CI/CD, failure injection
â”‚   â””â”€â”€ resources.md                # SDK reference + tool links + provider comparison
â”œâ”€â”€ agents/
â”‚   â”œâ”€â”€ observability-architect.md  # Designs full monitoring stacks by team size
â”‚   â”œâ”€â”€ incident-responder.md       # 4-phase incident protocol with solana CLI
â”‚   â””â”€â”€ metrics-engineer.md         # Implements metrics, histograms, PromQL
â”œâ”€â”€ commands/
â”‚   â”œâ”€â”€ health-check.md             # /obs-health-check â€” structured health report
â”‚   â”œâ”€â”€ dashboard-gen.md            # /obs-dashboard-gen â€” Grafana JSON from program ID
â”‚   â””â”€â”€ alert-audit.md              # /obs-alert-audit â€” coverage gaps + noise analysis
â”œâ”€â”€ rules/
â”‚   â”œâ”€â”€ metrics-naming.md           # Enforced solana_* naming + label cardinality
â”‚   â””â”€â”€ observability-patterns.md   # Code generation best practices
â”œâ”€â”€ deploy/                         # Working deployment stack
â”‚   â”œâ”€â”€ docker-compose.yml          # Prometheus + Grafana + Exporter
â”‚   â”œâ”€â”€ prometheus.yml              # Scrape configs for Solana metrics
â”‚   â”œâ”€â”€ alerting/
â”‚   â”‚   â””â”€â”€ solana-alerts.yml        # Production alert rules (12 alerts)
â”‚   â””â”€â”€ grafana/
â”‚       â”œâ”€â”€ dashboards/
â”‚       â”‚   â””â”€â”€ solana-overview.json  # Importable Grafana dashboard (8 panels)
â”‚       â””â”€â”€ provisioning/
â”‚           â”œâ”€â”€ dashboards/dashboards.yml
â”‚           â””â”€â”€ datasources/prometheus.yml
â”œâ”€â”€ examples/                       # Working TypeScript examples
â”‚   â”œâ”€â”€ rpc-health-monitor.ts       # Full RPC monitor with Prometheus export
â”‚   â”œâ”€â”€ geyser-stream-monitor.ts    # Geyser gRPC streaming with backpressure
â”‚   â””â”€â”€ security-monitor.ts         # Security monitoring with webhook alerts
â”œâ”€â”€ scripts/
â”‚   â””â”€â”€ smoke-test.sh               # Automated verification (20+ checks)
â”œâ”€â”€ package.json                    # npm project with all dependencies
â”œâ”€â”€ tsconfig.json                   # TypeScript strict mode config
â”œâ”€â”€ CLAUDE.md                       # Claude Code configuration + routing
â”œâ”€â”€ LICENSE                         # MIT
â”œâ”€â”€ README.md                       # This file
â””â”€â”€ install.sh                      # One-command installer
```

---

## Usage Examples

Once installed, ask your AI agent:

**RPC & Infrastructure:**
```
"Set up RPC health monitoring with automatic failover for my program"
"Add circuit breakers to my RPC layer with Prometheus metrics"
```

**Geyser Streaming:**
```
"Stream real-time account changes via Geyser gRPC with backpressure handling"
"Set up a Geyser failover manager with deduplication across multiple streams"
```

**Security:**
```
"Monitor my program for unauthorized authority changes"
"Add flash loan detection and drain alerts with multi-webhook notifications"
```

**Incidents:**
```
"/obs-health-check" â†’ Full infrastructure status report
"My transaction landing rate dropped â€” help me diagnose"
```

**Cost:**
```
"Profile my program's CU usage and recommend optimal priority fees"
"Set up dynamic priority fee management based on network conditions"
```

---

## Default Stack (Version-Pinned)

| Component | Version | Role |
|-----------|---------|------|
| Prometheus | 2.53.0 | Metrics storage + alerting |
| Grafana | 11.1.0 | Dashboards + visualization |
| OpenTelemetry Collector | 0.102.0 | Unified telemetry pipeline |
| pino | 9.x | Structured logging (Node.js) |
| prom-client | 15.x | Prometheus metrics (Node.js) |
| @solana/web3.js | 1.95+ | Solana RPC + WebSocket |
| @triton-one/yellowstone-grpc | 1.3+ | Geyser gRPC streaming |
| @coral-xyz/anchor | 0.30+ | IDL parsing + event decoding |

---

## Cross-Domain Coverage

| Domain | Whatâ€™s Monitored |
|--------|-----------------|
| **DeFi** | Swap failures, pool imbalance, MEV extraction, priority fee waste |
| **NFT** | Mint failures, metadata propagation, royalty enforcement |
| **Gaming** | Session transaction throughput, state account drift |
| **Payments** | Transfer confirmation latency, retry storms |
| **Validators** | Vote accuracy, skip rate trends, epoch performance |
| **Infrastructure** | RPC availability, Geyser stream health, WebSocket stability |

---

## Progressive Loading

This skill uses **token-efficient progressive loading** â€” the AI agent only loads the specific files needed for the current task:

```
User: "Help me set up RPC monitoring"
Agent loads: skill/SKILL.md â†’ skill/rpc-monitoring.md (382 lines)
NOT loaded: 11 other skill files (3,100+ lines saved)
```

The routing table in `SKILL.md` maps tasks to files. This keeps context windows lean and responses fast.

---

## Workflow Conventions

- **Two-Strike Rule:** If a monitoring approach doesnâ€™t work after two attempts, the agent escalates to `observability-architect` for a full redesign
- **Metrics Naming:** All metrics follow `solana_{domain}_{metric}_{unit}` convention (enforced by `rules/metrics-naming.md`)
- **Label Cardinality:** Never use unbounded values (signatures, addresses) as metric labels â€” bounded enums only

---

## Contributing

```bash
git clone https://github.com/SBALAVIGNESH123/solana-observability-skill.git
cd solana-observability-skill
npm install

# Run smoke test
bash scripts/smoke-test.sh

# Make changes, then:
git checkout -b feat/your-improvement
git commit -m "feat: description"
git push origin feat/your-improvement
```

---

## License

[MIT](LICENSE) â€” free to use, modify, merge, and submodule into any project.

---

## Links

- **Solana AI Kit:** https://github.com/solanabr/solana-ai-kit
- **Reference Skill:** https://github.com/solanabr/solana-game-skill
- **This Skill:** https://github.com/SBALAVIGNESH123/solana-observability-skill

# Changelog

All notable changes to solana-observability-skill.

## [2.0.1] - 2024-06-24

### Fixed
- `examples/rpc-health-monitor.ts`: Added HTTP server serving `/metrics` on port 9100 -- docker-compose healthcheck was failing because metrics were only logged to console
- `deploy/docker-compose.yml`: Mount `package.json` and `tsconfig.json` into container -- `npm install` was silently failing without them
- `examples/security-monitor.ts`: Replaced invalid placeholder PublicKeys with real SPL Token program IDs -- old ones crashed at runtime
- `deploy/prometheus.yml`: Changed `node_exporter` target to port 9101 to avoid collision with `solana-exporter` on port 9100
- All 23 files: Fixed triple-encoded UTF-8 that caused garbled characters on GitHub (box-drawing, em-dashes, arrows, smart quotes all replaced with clean ASCII)
- `README.md`: Complete rewrite with ASCII-only architecture diagram and directory tree

### Added
- `examples/geyser-stream-monitor.ts` listed in README structure and `package.json` scripts
- `/health` endpoint on RPC health monitor for liveness probes
- `CHANGELOG.md` (this file)

## [2.0.0] - 2024-06-24

### Added
- 12 progressive skill files covering RPC monitoring, Geyser streaming, transaction metrics, validator monitoring, security monitoring, SLO alerting, program instrumentation, dashboards, distributed tracing, cost optimization, chaos testing, and resources
- 3 specialized agents: observability-architect, incident-responder, metrics-engineer
- 3 slash commands: `/obs-health-check`, `/obs-dashboard-gen`, `/obs-alert-audit`
- 2 rules: metrics-naming conventions, observability patterns
- Full deploy stack: Docker Compose with Prometheus, Grafana, and custom Solana exporter
- 12 Prometheus alert rules across 5 groups (RPC health, transactions, security, validators, SLO burn rate)
- Grafana dashboard with 8 auto-provisioned panels
- 3 working TypeScript examples with real Prometheus metrics export
- Smoke test script with 20+ automated checks
- One-command installer script
- Deployment proof screenshots (Grafana dashboard, Prometheus UI)

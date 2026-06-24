# CLAUDE.md -- Solana Observability Skill Configuration

## Skill Loading

This skill follows progressive loading. Only load the skill file relevant to the current task:

- RPC monitoring -> `skill/rpc-monitoring.md`
- Geyser streaming -> `skill/geyser-streaming.md`
- Transaction metrics -> `skill/transaction-metrics.md`
- Validator monitoring -> `skill/validator-monitoring.md`
- Security alerts -> `skill/security-monitoring.md`
- SLO alerting -> `skill/alerting-slo.md`
- Program CU profiling -> `skill/program-instrumentation.md`
- Dashboards -> `skill/dashboards.md`
- Distributed tracing -> `skill/distributed-tracing.md`

## Rules (Always Active)

- Follow naming conventions in `rules/metrics-naming.md`
- Follow code patterns in `rules/observability-patterns.md`

## Agents

- Use `agents/observability-architect.md` for full stack design
- Use `agents/incident-responder.md` during active incidents
- Use `agents/metrics-engineer.md` for implementation tasks

## Commands

- `/obs-health-check` -- Run infrastructure health check
- `/obs-dashboard-gen` -- Generate Grafana dashboard
- `/obs-alert-audit` -- Audit alert rule coverage

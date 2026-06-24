# Command: /obs-health-check

Run a comprehensive health check on Solana observability infrastructure.

## Usage

```
/obs-health-check [--endpoint <rpc-url>] [--program <program-id>]
```

## What It Checks

1. **RPC Connectivity** -- Can we reach the configured RPC endpoint?
2. **Slot Freshness** -- Is the RPC within 10 slots of the cluster tip?
3. **Transaction Landing** -- Submit a dummy memo tx and verify it lands
4. **Prometheus Scrape** -- Is the metrics endpoint responding?
5. **Grafana Access** -- Can we reach the Grafana API?
6. **Alert Rules** -- Are Prometheus alert rules loaded?

## Output Format

```
✅ RPC: https://api.mainnet-beta.solana.com (slot 285432100, 0 behind)
✅ Latency: p50=45ms, p99=180ms (last 100 requests)
✅ Prometheus: http://localhost:9090 (423 active series)
✅ Grafana: http://localhost:3000 (5 dashboards provisioned)
✅ Alerts: 12 rules loaded, 0 currently firing
⚠️ Warning: No Geyser stream connected (optional)
❌ FAIL: Landing rate at 92% (below 99.5% SLO)
```

## Implementation Guidance

The agent should:
1. Read environment variables or prompt for RPC endpoint
2. Execute health checks sequentially
3. Report results with clear pass/fail indicators
4. Suggest fixes for any failures

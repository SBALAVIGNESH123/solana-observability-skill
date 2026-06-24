# Command: /obs-dashboard-gen

Generate a Grafana dashboard JSON for a specific Solana program.

## Usage

```
/obs-dashboard-gen <program-id> [--name <dashboard-name>] [--include-security]
```

## What It Generates

Given a program ID (and optionally its IDL), generate a complete Grafana dashboard with:

1. **Transaction Overview** -- Rate, success/failure, CU distribution
2. **Instruction Breakdown** -- Per-instruction CU and error rates (if IDL provided)
3. **Account Health** -- Balance tracking for program-owned accounts
4. **Latency Panel** -- Transaction confirmation time percentiles
5. **Error Classification** -- Error types with drill-down
6. **Security Panel** (optional) -- Authority status, large balance changes

## Output

A valid Grafana dashboard JSON file that can be:
- Imported via Grafana UI (Dashboard -> Import)
- Provisioned via filesystem
- Committed to git as dashboard-as-code

## Implementation Guidance

The agent should:
1. Accept a program ID (and optionally fetch its IDL from chain)
2. Generate appropriate PromQL queries using the standard metric names from this skill
3. Output valid Grafana dashboard JSON (schema version 38+)
4. Include template variables for time range and data source selection

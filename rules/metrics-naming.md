# Rule: Metrics Naming Conventions

## Enforced Standards

All Prometheus metrics in Solana observability code MUST follow these naming conventions:

### Format
```
solana_<subsystem>_<metric_name>_<unit>
```

### Units (suffix)
| Unit | Suffix | Example |
|------|--------|---------|
| Seconds | `_seconds` | `solana_rpc_request_duration_seconds` |
| Bytes | `_bytes` | `solana_account_data_bytes` |
| Total (counter) | `_total` | `solana_tx_landed_total` |
| Ratio (0-1) | `_ratio` | `solana_compute_efficiency_ratio` |
| SOL | `_sol` | `solana_account_balance_sol` |
| Lamports | `_lamports` | `solana_priority_fee_lamports` |
| No unit (gauge) | (none) | `solana_rpc_up` |

### Subsystems
| Subsystem | Prefix | Domain |
|-----------|--------|--------|
| RPC | `solana_rpc_` | RPC node health |
| Transaction | `solana_tx_` | Transaction lifecycle |
| Validator | `solana_validator_` | Validator performance |
| Program | `solana_program_` | On-chain program |
| Account | `solana_account_` | Account state |
| Geyser | `solana_geyser_` | Streaming pipeline |
| Security | `solana_security_` | Security events |
| Jito | `solana_jito_` | MEV/bundles |

### Labels
- Use `snake_case` for label names
- Max 5 labels per metric
- NEVER use unbounded values as labels (signatures, pubkeys, slot numbers)
- Acceptable bounded labels: `status`, `provider`, `method`, `severity`, `type`, `priority`

### Counter vs Gauge vs Histogram
- **Counter**: Monotonically increasing (events, errors, total requests)
- **Gauge**: Can go up or down (current slot, balance, queue depth)
- **Histogram**: Distribution of values (latency, CU consumption, fees)

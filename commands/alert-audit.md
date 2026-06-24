# Command: /obs-alert-audit

Audit existing Prometheus alert rules for gaps, noise, and best practices.

## Usage

```
/obs-alert-audit [--rules-file <path>] [--check-slo]
```

## What It Checks

### Coverage Gaps
- Is RPC health monitored?
- Is transaction landing rate tracked?
- Are security events (authority changes) alerted on?
- Is there an "all endpoints down" critical alert?
- Are SLO burn rates defined (not just raw thresholds)?

### Noise Problems
- Alerts without `for:` duration (will fire on transient spikes)
- Alerts with too-short `for:` (<1m for non-critical)
- Too many labels creating alert fatigue
- Missing severity labels (can't route properly)

### Best Practices
- Are recording rules used for expensive queries?
- Are multi-window burn rates used instead of single-threshold?
- Do alerts have runbook links?
- Are alerts grouped by service/component?

## Output

```
📊 Alert Audit Report
---------------------

Coverage: 7/10 critical scenarios covered
  ✅ RPC health monitoring
  ✅ Transaction failures
  ✅ Security: authority changes
  ❌ MISSING: Landing rate SLO
  ❌ MISSING: Validator delinquency
  ❌ MISSING: Error budget burn rate

Noise Score: 3/10 (good -- low noise risk)
  ⚠️ "RPCHighLatency" has no `for:` duration -- will fire on single spike

Recommendations:
  1. Add multi-window burn rate alerts for landing rate SLO
  2. Add `for: 2m` to RPCHighLatency
  3. Add `runbook_url` annotation to all alerts
  4. Consider adding validator skip rate alert
```

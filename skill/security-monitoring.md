# Security Monitoring -- Exploit Detection & Authority Change Alerts

Real-time security monitoring for Solana programs: detect authority changes, large token drains, suspicious patterns, and known exploit signatures.

## Threat Model

| Threat | Detection Method | Response |
|--------|-----------------|----------|
| Authority change (upgrade/admin) | Monitor authority accounts via Geyser | Immediate alert + freeze check |
| Large drain (>X SOL/tokens) | Balance change delta monitoring | Alert + trace source |
| Flash loan attack | Atomic balance spike then drain in same tx | Pattern detection in tx logs |
| Reentrancy | Nested CPI depth > threshold | Static analysis + runtime detection |
| Oracle manipulation | Price deviation > N% from multiple sources | Cross-feed comparison |
| Governance takeover | Vote account authority change | Monitor governance program |
| Sandwich attack | Tx ordering anomalies around user tx | MEV pattern detection |
| Account ownership transfer | Unexpected `Assign` system program call | System program monitoring |

## Authority Change Monitor

```typescript
import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { Counter, Gauge } from 'prom-client';

interface WatchedAuthority {
  label: string;
  account: PublicKey;
  authorityOffset: number;    // byte offset in account data where authority pubkey lives
  expectedAuthority: string;  // expected value
}

interface AlertPayload {
  severity: 'critical' | 'high' | 'medium' | 'info';
  message: string;
  timestamp: string;
  context: string;
  source: string;
}

export class SecurityMonitor {
  private watchedAuthorities: WatchedAuthority[] = [];
  private alertWebhooks: string[];  // Multiple webhook endpoints for redundancy
  private metrics: SecurityMetrics;
  private readonly MAX_ALERT_CONTEXT_BYTES = 500;

  constructor(alertWebhooks: string | string[], registry: any) {
    this.alertWebhooks = Array.isArray(alertWebhooks) ? alertWebhooks : [alertWebhooks];
    this.metrics = new SecurityMetrics(registry);
  }

  addAuthorityWatch(watch: WatchedAuthority): void {
    this.watchedAuthorities.push(watch);
  }

  async checkAuthorities(connection: Connection): Promise<void> {
    for (const watch of this.watchedAuthorities) {
      try {
        const accountInfo = await connection.getAccountInfo(watch.account);
        if (!accountInfo) {
          this.metrics.securityAlerts.inc({ type: 'account_closed', severity: 'critical' });
          await this.fireAlert('critical', `Account ${watch.label} has been CLOSED`, watch);
          continue;
        }

        const currentAuthority = new PublicKey(
          accountInfo.data.subarray(watch.authorityOffset, watch.authorityOffset + 32)
        ).toBase58();

        if (currentAuthority !== watch.expectedAuthority) {
          this.metrics.securityAlerts.inc({ type: 'authority_changed', severity: 'critical' });
          await this.fireAlert('critical',
            `Authority for ${watch.label} CHANGED!\n` +
            `Expected: ${watch.expectedAuthority}\n` +
            `Actual: ${currentAuthority}`,
            watch
          );
        }
      } catch (err: any) {
        this.metrics.securityCheckErrors.inc({ check: 'authority' });
      }
    }
  }

  /** Monitor for large balance changes (potential drains) */
  async monitorBalances(
    connection: Connection,
    accounts: { label: string; pubkey: PublicKey; thresholdSol: number }[]
  ): Promise<void> {
    for (const acc of accounts) {
      const balance = await connection.getBalance(acc.pubkey);
      const balanceSol = balance / 1e9;

      this.metrics.monitoredBalance.set({ account: acc.label }, balanceSol);

      // Check for large decrease
      const prevBalance = this.metrics.getPrevBalance(acc.label);
      if (prevBalance !== null) {
        const delta = prevBalance - balanceSol;
        if (delta > acc.thresholdSol) {
          this.metrics.securityAlerts.inc({ type: 'large_drain', severity: 'high' });
          await this.fireAlert('high',
            `Large balance decrease on ${acc.label}: -${delta.toFixed(2)} SOL\n` +
            `Previous: ${prevBalance.toFixed(2)} SOL\n` +
            `Current: ${balanceSol.toFixed(2)} SOL`,
            acc
          );
        }
      }
      this.metrics.setPrevBalance(acc.label, balanceSol);
    }
  }

  /** Detect suspicious transaction patterns */
  analyzeTransaction(logs: string[], signature: string): SecurityEvent[] {
    const events: SecurityEvent[] = [];

    // Pattern: Multiple CPI calls to same program (potential reentrancy)
    const cpiCount = logs.filter(l => l.includes('Program invoke:')).length;
    if (cpiCount > 10) {
      events.push({
        type: 'high_cpi_depth',
        severity: 'medium',
        signature,
        detail: `Unusually deep CPI chain (${cpiCount} invocations)`,
      });
    }

    // Pattern: Authority set in the same tx as a large transfer
    const hasAuthorityChange = logs.some(l => l.includes('SetAuthority'));
    const hasTransfer = logs.some(l => l.includes('Transfer'));
    if (hasAuthorityChange && hasTransfer) {
      events.push({
        type: 'authority_and_transfer',
        severity: 'high',
        signature,
        detail: 'Authority change + transfer in same tx',
      });
    }

    // Pattern: Program upgrade
    if (logs.some(l => l.includes('Upgradeable program was upgraded'))) {
      events.push({
        type: 'program_upgrade',
        severity: 'info',
        signature,
        detail: 'Program was upgraded',
      });
    }

    // Pattern: Flash loan signature (large borrow + repay in single tx)
    const hasLargeBorrow = logs.some(l => l.includes('Borrow') || l.includes('FlashLoan'));
    const hasRepay = logs.some(l => l.includes('Repay') || l.includes('FlashRepay'));
    if (hasLargeBorrow && hasRepay) {
      events.push({
        type: 'flash_loan',
        severity: 'medium',
        signature,
        detail: 'Flash loan pattern detected (borrow + repay in single tx)',
      });
    }

    // Pattern: Account close after drain
    const hasClose = logs.some(l => l.includes('CloseAccount'));
    if (hasClose && hasTransfer) {
      events.push({
        type: 'drain_and_close',
        severity: 'high',
        signature,
        detail: 'Account closed immediately after transfer -- possible drain',
      });
    }

    // Record metrics
    for (const event of events) {
      this.metrics.securityAlerts.inc({ type: event.type, severity: event.severity });
    }

    return events;
  }

  private async fireAlert(severity: AlertPayload['severity'], message: string, context: any): Promise<void> {
    const payload: AlertPayload = {
      severity,
      message,
      timestamp: new Date().toISOString(),
      context: JSON.stringify(context).slice(0, this.MAX_ALERT_CONTEXT_BYTES),
      source: 'solana-observability-skill',
    };

    // Fan-out to all configured webhooks for redundancy
    const results = await Promise.allSettled(
      this.alertWebhooks.map(webhook =>
        fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      )
    );

    // Check if at least one succeeded
    const anySuccess = results.some(r => r.status === 'fulfilled' && (r.value as Response).ok);
    if (!anySuccess) {
      console.error(`ALERT DELIVERY FAILED (all ${this.alertWebhooks.length} webhooks): ${severity} - ${message}`);
      this.metrics.alertDeliveryFailures.inc({ severity });
    }
  }
}

interface SecurityEvent {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'info';
  signature: string;
  detail: string;
}

class SecurityMetrics {
  securityAlerts: Counter;
  securityCheckErrors: Counter;
  monitoredBalance: Gauge;
  alertDeliveryFailures: Counter;
  private prevBalances: Map<string, number> = new Map();

  constructor(registry: any) {
    this.securityAlerts = new Counter({
      name: 'solana_security_alerts_total',
      help: 'Security alerts fired',
      labelNames: ['type', 'severity'],
      registers: [registry],
    });
    this.securityCheckErrors = new Counter({
      name: 'solana_security_check_errors_total',
      help: 'Errors during security checks',
      labelNames: ['check'],
      registers: [registry],
    });
    this.monitoredBalance = new Gauge({
      name: 'solana_monitored_balance_sol',
      help: 'Balance of monitored security accounts',
      labelNames: ['account'],
      registers: [registry],
    });
    this.alertDeliveryFailures = new Counter({
      name: 'solana_alert_delivery_failures_total',
      help: 'Failed alert webhook deliveries',
      labelNames: ['severity'],
      registers: [registry],
    });
  }

  getPrevBalance(label: string): number | null {
    return this.prevBalances.get(label) ?? null;
  }
  setPrevBalance(label: string, value: number): void {
    this.prevBalances.set(label, value);
  }
}
```

## Prometheus Alert Rules -- Security

```yaml
groups:
  - name: solana_security_alerts
    rules:
      - alert: AuthorityChanged
        expr: increase(solana_security_alerts_total{type="authority_changed"}[5m]) > 0
        labels:
          severity: critical
        annotations:
          summary: "CRITICAL: Program authority has been changed!"
          runbook: "1. Verify if this was authorized. 2. Check program state. 3. If unauthorized, invoke emergency freeze."

      - alert: LargeDrain
        expr: increase(solana_security_alerts_total{type="large_drain"}[5m]) > 0
        labels:
          severity: high
        annotations:
          summary: "Large balance drain detected on monitored account"

      - alert: SuspiciousPatternDetected
        expr: rate(solana_security_alerts_total{severity=~"high|critical"}[10m]) > 0.5
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Multiple high-severity security events in short timeframe"

      - alert: AlertDeliveryFailure
        expr: increase(solana_alert_delivery_failures_total[5m]) > 0
        labels:
          severity: warning
        annotations:
          summary: "Security alerts are failing to deliver -- check webhook configuration"
```

## Integration with Existing Tools

| Tool | Integration Point | Purpose |
|------|------------------|---------|
| Trail of Bits / Caracal | Pre-deploy static analysis | Find vulnerabilities before they're exploitable |
| OtterSec Watch | Post-deploy runtime | Cross-reference with known exploit signatures |
| Sec3 (auto-audit) | CI pipeline | Automated security scanning |
| Blowfish | Transaction simulation | Preview tx effects before signing |
| Ellipsis Labs / Cypher | DeFi monitoring | Protocol-specific exploit detection |
| This skill | Runtime monitoring | Detect exploits as they happen |

## Emergency Response Automation

When a critical alert fires, the agent should recommend:

1. **Verify** -- Is this an authorized operation? Check multisig/governance logs.
2. **Freeze** -- If unauthorized, invoke program freeze authority (if available).
3. **Trace** -- Use explorer + Geyser history to trace fund movement.
4. **Notify** -- Alert team via PagerDuty/Slack/Discord.
5. **Document** -- Create incident timeline for post-mortem.

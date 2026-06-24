/**
 * Solana Observability Skill — Security Monitor Example
 *
 * Real-time detection of authority changes, large drains, and
 * suspicious patterns on Solana programs.
 */

import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { Counter, Gauge } from 'prom-client';

// --- Types ---

interface WatchedAuthority {
  programId: PublicKey;
  authorityType: 'upgrade' | 'freeze' | 'mint' | 'owner';
  expectedAuthority: PublicKey;
  label: string;
}

interface SecurityAlert {
  type: 'authority_change' | 'large_drain' | 'flash_loan' | 'drain_and_close';
  severity: 'critical' | 'high' | 'medium';
  programId: string;
  details: string;
  timestamp: Date;
  slot: number;
}

// --- Metrics ---

const alertsTotal = new Counter({
  name: 'solana_security_alerts_total',
  help: 'Total security alerts fired',
  labelNames: ['type', 'severity', 'program'],
});

const authorityStatus = new Gauge({
  name: 'solana_security_authority_valid',
  help: '1 if authority matches expected, 0 if changed',
  labelNames: ['program', 'authority_type'],
});

const alertDeliveryFailures = new Counter({
  name: 'solana_security_alert_delivery_failures_total',
  help: 'Failed alert webhook deliveries',
  labelNames: ['webhook'],
});

// --- Security Monitor ---

export class SecurityMonitor {
  private connection: Connection;
  private watchedAuthorities: WatchedAuthority[];
  private webhooks: string[];
  private subscriptions: number[] = [];

  constructor(
    rpcUrl: string,
    watchedAuthorities: WatchedAuthority[],
    webhooks: string[]
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.watchedAuthorities = watchedAuthorities;
    this.webhooks = webhooks;
  }

  async start(): Promise<void> {
    for (const watched of this.watchedAuthorities) {
      const subId = this.connection.onAccountChange(
        watched.programId,
        (accountInfo: AccountInfo<Buffer>, context) => {
          this.checkAuthorityChange(watched, accountInfo, context.slot);
        },
        'confirmed'
      );
      this.subscriptions.push(subId);
    }
  }

  async shutdown(): Promise<void> {
    for (const subId of this.subscriptions) {
      await this.connection.removeAccountChangeListener(subId);
    }
    this.subscriptions = [];
  }

  private checkAuthorityChange(
    watched: WatchedAuthority,
    accountInfo: AccountInfo<Buffer>,
    slot: number
  ): void {
    // Parse authority from account data based on type
    const currentAuthority = this.parseAuthority(accountInfo, watched.authorityType);

    if (currentAuthority && !currentAuthority.equals(watched.expectedAuthority)) {
      const alert: SecurityAlert = {
        type: 'authority_change',
        severity: 'critical',
        programId: watched.programId.toBase58(),
        details: `${watched.label}: authority changed from ${watched.expectedAuthority.toBase58()} to ${currentAuthority.toBase58()}`,
        timestamp: new Date(),
        slot,
      };

      alertsTotal.inc({
        type: alert.type,
        severity: alert.severity,
        program: watched.label,
      });

      authorityStatus.set(
        { program: watched.label, authority_type: watched.authorityType },
        0
      );

      this.fireAlert(alert);
    } else {
      authorityStatus.set(
        { program: watched.label, authority_type: watched.authorityType },
        1
      );
    }
  }

  private parseAuthority(
    accountInfo: AccountInfo<Buffer>,
    authorityType: string
  ): PublicKey | null {
    try {
      // Upgrade authority is at offset 4 in program data accounts
      if (authorityType === 'upgrade') {
        const authorityBytes = accountInfo.data.slice(4, 36);
        return new PublicKey(authorityBytes);
      }
      // Mint authority is at offset 0 in SPL Token mint accounts
      if (authorityType === 'mint') {
        const authorityBytes = accountInfo.data.slice(0, 32);
        return new PublicKey(authorityBytes);
      }
      return null;
    } catch {
      return null;
    }
  }

  private async fireAlert(alert: SecurityAlert): Promise<void> {
    const payload = JSON.stringify({
      text: `🚨 SECURITY ALERT [${alert.severity.toUpperCase()}]`,
      type: alert.type,
      program: alert.programId,
      details: alert.details,
      slot: alert.slot,
      timestamp: alert.timestamp.toISOString(),
    });

    // Fan-out to all webhooks for redundancy
    await Promise.allSettled(
      this.webhooks.map(async (webhook) => {
        try {
          const response = await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          });
          if (!response.ok) {
            alertDeliveryFailures.inc({ webhook });
          }
        } catch {
          alertDeliveryFailures.inc({ webhook });
        }
      })
    );
  }
}

// --- Usage ---

async function main() {
  const monitor = new SecurityMonitor(
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    [
      {
        programId: new PublicKey('YourProgramId11111111111111111111111111111'),
        authorityType: 'upgrade',
        expectedAuthority: new PublicKey('YourAuthority1111111111111111111111111111'),
        label: 'my-defi-program',
      },
    ],
    [
      process.env.SLACK_WEBHOOK_URL!,
      process.env.PAGERDUTY_WEBHOOK_URL!,
    ]
  );

  await monitor.start();
  console.log('Security monitor active — watching for authority changes...');

  process.on('SIGTERM', async () => {
    await monitor.shutdown();
    process.exit(0);
  });
}

main().catch(console.error);

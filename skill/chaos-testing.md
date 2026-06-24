# Chaos Testing -- Resilience Engineering for Solana Infrastructure

Systematic chaos engineering to validate your observability stack under failure conditions. Ensures alerts fire, dashboards show correct data, and runbooks work before real incidents happen.

## Why Chaos Testing for Observability

| Without Chaos Testing | With Chaos Testing |
|----------------------|-------------------|
| Alerts might not fire | Verified alert triggers |
| Dashboard gaps unknown | Dashboard coverage validated |
| Runbooks are theoretical | Runbooks tested in practice |
| Blind spots in monitoring | Known monitoring boundaries |
| Incident response untested | Team practiced and ready |

## Chaos Experiment Framework

```typescript
import { Connection, PublicKey } from '@solana/web3.js';

interface ChaosExperiment {
  name: string;
  description: string;
  targetComponent: 'rpc' | 'geyser' | 'validator' | 'program' | 'network';
  severity: 'low' | 'medium' | 'high';
  duration: number; // seconds
  execute: () => Promise<ChaosResult>;
  verify: () => Promise<VerificationResult>;
  rollback: () => Promise<void>;
}

interface ChaosResult {
  success: boolean;
  startTime: number;
  endTime: number;
  observations: string[];
}

interface VerificationResult {
  alertsFired: string[];
  alertsMissed: string[];
  dashboardsAffected: string[];
  metricsRecorded: boolean;
  runbookTriggered: boolean;
}

export class ChaosRunner {
  private experiments: ChaosExperiment[] = [];
  private results: Map<string, { chaos: ChaosResult; verification: VerificationResult }> = new Map();

  addExperiment(experiment: ChaosExperiment): void {
    this.experiments.push(experiment);
  }

  async runExperiment(name: string): Promise<{ chaos: ChaosResult; verification: VerificationResult }> {
    const experiment = this.experiments.find(e => e.name === name);
    if (!experiment) throw new Error(`Experiment ${name} not found`);

    console.log(`🔥 Starting chaos experiment: ${experiment.name}`);
    console.log(`   Target: ${experiment.targetComponent} | Severity: ${experiment.severity}`);
    console.log(`   Duration: ${experiment.duration}s`);

    let chaosResult: ChaosResult;
    try {
      chaosResult = await experiment.execute();
    } catch (err: any) {
      chaosResult = {
        success: false,
        startTime: Date.now(),
        endTime: Date.now(),
        observations: [`Experiment failed to execute: ${err.message}`],
      };
    }

    // Wait for observability pipeline to process
    console.log('   ⏳ Waiting for observability pipeline to process...');
    await new Promise(resolve => setTimeout(resolve, 30_000));

    // Verify monitoring detected the chaos
    const verification = await experiment.verify();

    // Rollback
    console.log('   🔄 Rolling back...');
    await experiment.rollback();

    const result = { chaos: chaosResult, verification };
    this.results.set(name, result);

    // Report
    this.printReport(experiment, result);
    return result;
  }

  private printReport(
    experiment: ChaosExperiment,
    result: { chaos: ChaosResult; verification: VerificationResult }
  ): void {
    console.log(`\n📊 Chaos Report: ${experiment.name}`);
    console.log('-'.repeat(50));
    console.log(`Chaos executed: ${result.chaos.success ? '✅' : '❌'}`);
    console.log(`Alerts fired: ${result.verification.alertsFired.join(', ') || 'none'}`);
    console.log(`Alerts MISSED: ${result.verification.alertsMissed.join(', ') || 'none ✅'}`);
    console.log(`Metrics recorded: ${result.verification.metricsRecorded ? '✅' : '❌'}`);
    console.log(`Runbook triggered: ${result.verification.runbookTriggered ? '✅' : '❌'}`);

    if (result.verification.alertsMissed.length > 0) {
      console.log('\n⚠️  GAPS FOUND -- fix these before production:');
      for (const alert of result.verification.alertsMissed) {
        console.log(`   - Missing alert: ${alert}`);
      }
    }
  }

  getResults(): Map<string, { chaos: ChaosResult; verification: VerificationResult }> {
    return this.results;
  }
}
```

## Pre-Built Chaos Experiments

### 1. RPC Endpoint Failure

```typescript
function createRPCFailureExperiment(
  rpcMonitor: any,
  prometheusUrl: string
): ChaosExperiment {
  let originalEndpoints: any[];

  return {
    name: 'rpc-endpoint-failure',
    description: 'Simulate primary RPC endpoint going down',
    targetComponent: 'rpc',
    severity: 'medium',
    duration: 120,

    async execute() {
      const start = Date.now();
      // Block primary endpoint (e.g., via local proxy or DNS override)
      originalEndpoints = rpcMonitor.getEndpoints();
      // Simulate by poisoning the primary endpoint URL
      rpcMonitor.setEndpointHealth(originalEndpoints[0].url, false);

      return {
        success: true,
        startTime: start,
        endTime: Date.now(),
        observations: ['Primary RPC endpoint marked unhealthy'],
      };
    },

    async verify() {
      // Check Prometheus for expected alerts
      const alerts = await fetchFiredAlerts(prometheusUrl);
      const expectedAlerts = ['RPCEndpointDown'];
      const firedNames = alerts.map((a: any) => a.labels.alertname);

      return {
        alertsFired: expectedAlerts.filter(a => firedNames.includes(a)),
        alertsMissed: expectedAlerts.filter(a => !firedNames.includes(a)),
        dashboardsAffected: ['rpc-health'],
        metricsRecorded: alerts.length > 0,
        runbookTriggered: firedNames.includes('RPCEndpointDown'),
      };
    },

    async rollback() {
      rpcMonitor.setEndpointHealth(originalEndpoints[0].url, true);
    },
  };
}
```

### 2. Geyser Stream Interruption

```typescript
function createGeyserInterruptionExperiment(
  geyserObserver: any,
  prometheusUrl: string
): ChaosExperiment {
  return {
    name: 'geyser-stream-interrupt',
    description: 'Simulate Geyser gRPC stream disconnection',
    targetComponent: 'geyser',
    severity: 'high',
    duration: 60,

    async execute() {
      const start = Date.now();
      // Force stream disconnect
      await geyserObserver.forceDisconnect();

      return {
        success: true,
        startTime: start,
        endTime: Date.now(),
        observations: ['Geyser stream forcefully disconnected'],
      };
    },

    async verify() {
      const alerts = await fetchFiredAlerts(prometheusUrl);
      const metrics = await fetchMetric(prometheusUrl, 'solana_geyser_reconnects_total');

      return {
        alertsFired: metrics > 0 ? ['GeyserReconnect'] : [],
        alertsMissed: metrics === 0 ? ['GeyserReconnect'] : [],
        dashboardsAffected: ['geyser-streaming'],
        metricsRecorded: metrics > 0,
        runbookTriggered: false,
      };
    },

    async rollback() {
      // Observer auto-reconnects -- just verify it recovered
      await new Promise(resolve => setTimeout(resolve, 5000));
    },
  };
}
```

### 3. Simulated Security Incident

```typescript
function createSecurityAlertExperiment(
  securityMonitor: any,
  prometheusUrl: string
): ChaosExperiment {
  return {
    name: 'security-authority-change',
    description: 'Simulate an unauthorized authority change detection',
    targetComponent: 'program',
    severity: 'high',
    duration: 30,

    async execute() {
      const start = Date.now();
      // Trigger a synthetic security event
      securityMonitor.analyzeTransaction(
        [
          'Program log: Instruction: SetAuthority',
          'Program log: Transfer 1000000000 lamports',
          'Program success',
        ],
        'SimulatedChaos1111111111111111111111111111111111111111111111'
      );

      return {
        success: true,
        startTime: start,
        endTime: Date.now(),
        observations: ['Synthetic authority_and_transfer event injected'],
      };
    },

    async verify() {
      const metrics = await fetchMetric(
        prometheusUrl,
        'solana_security_alerts_total{type="authority_and_transfer"}'
      );

      return {
        alertsFired: metrics > 0 ? ['AuthorityAndTransfer'] : [],
        alertsMissed: metrics === 0 ? ['AuthorityAndTransfer'] : [],
        dashboardsAffected: ['security-monitoring'],
        metricsRecorded: metrics > 0,
        runbookTriggered: metrics > 0,
      };
    },

    async rollback() {
      // No rollback needed -- synthetic event doesn't affect state
    },
  };
}
```

## Helper Functions

```typescript
async function fetchFiredAlerts(prometheusUrl: string): Promise<any[]> {
  const response = await fetch(`${prometheusUrl}/api/v1/alerts`);
  const data = await response.json();
  return data.data?.alerts?.filter((a: any) => a.state === 'firing') || [];
}

async function fetchMetric(prometheusUrl: string, metric: string): Promise<number> {
  const response = await fetch(
    `${prometheusUrl}/api/v1/query?query=${encodeURIComponent(metric)}`
  );
  const data = await response.json();
  const result = data.data?.result?.[0]?.value?.[1];
  return result ? parseFloat(result) : 0;
}
```

## Chaos Testing Schedule

| Frequency | Experiment | Environment |
|-----------|-----------|-------------|
| Daily (automated) | RPC endpoint failure | Staging |
| Weekly | Geyser stream interruption | Staging |
| Weekly | High-priority-fee spike simulation | Staging |
| Monthly | Full stack failure (all RPCs down) | Staging |
| Quarterly | Security incident simulation | Staging + alert verification in production channels |

## Integration with CI/CD

```yaml
# .github/workflows/chaos-test.yml
name: Chaos Tests
on:
  schedule:
    - cron: '0 3 * * 1'  # Every Monday at 3 AM

jobs:
  chaos:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Start monitoring stack
        run: docker compose -f docker-compose.monitoring.yml up -d
      - name: Wait for stack ready
        run: sleep 30
      - name: Run chaos experiments
        run: npx tsx chaos/run-all.ts
      - name: Collect results
        run: npx tsx chaos/report.ts > chaos-report.md
      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: chaos-report
          path: chaos-report.md
      - name: Fail on gaps
        run: npx tsx chaos/check-gaps.ts
```

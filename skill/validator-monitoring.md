# Validator Monitoring -- Vote Latency, Skip Rate, Delinquency

Production monitoring for Solana validators: performance tracking, stake health, epoch boundary alerts, and cluster participation metrics.

## Key Validator Metrics

| Metric | What It Means | Alert Threshold |
|--------|--------------|-----------------|
| Vote latency | Time between slot production and vote | >2 slots |
| Skip rate | % of assigned slots where leader didn't produce a block | >5% (epoch) |
| Delinquency | Validator not voting for extended period | Any delinquency |
| Credit differential | Vote credits earned vs cluster average | <95% of average |
| Stake activation | Pending stake activations/deactivations | Large changes |

## Validator Health Monitor

```typescript
import { Connection, VoteAccountInfo } from '@solana/web3.js';
import { Gauge, Counter, Histogram, Registry } from 'prom-client';

interface ValidatorConfig {
  identity: string;       // Validator identity pubkey
  voteAccount: string;    // Vote account pubkey
  connection: Connection;
  checkIntervalMs: number;
}

export class ValidatorMonitor {
  private config: ValidatorConfig;
  private lastEpoch = 0;
  private metrics: ValidatorMetrics;

  constructor(config: ValidatorConfig, registry: Registry) {
    this.config = config;
    this.metrics = new ValidatorMetrics(registry);
  }

  async collectMetrics(): Promise<void> {
    await Promise.all([
      this.collectVoteAccountInfo(),
      this.collectBlockProduction(),
      this.collectEpochInfo(),
      this.collectLeaderSchedule(),
    ]);
  }

  private async collectVoteAccountInfo(): Promise<void> {
    const voteAccounts = await this.config.connection.getVoteAccounts();
    const allAccounts = [...voteAccounts.current, ...voteAccounts.delinquent];
    const ours = allAccounts.find(v => v.votePubkey === this.config.voteAccount);

    if (!ours) {
      this.metrics.validatorActive.set(0);
      return;
    }

    const isDelinquent = voteAccounts.delinquent.some(
      v => v.votePubkey === this.config.voteAccount
    );

    this.metrics.validatorActive.set(isDelinquent ? 0 : 1);
    this.metrics.activatedStake.set(ours.activatedStake / 1e9); // in SOL
    this.metrics.lastVote.set(ours.lastVote);
    this.metrics.commission.set(ours.commission);

    // Credits earned this epoch
    if (ours.epochCredits.length > 0) {
      const [epoch, credits, prevCredits] = ours.epochCredits[ours.epochCredits.length - 1];
      this.metrics.epochCredits.set(credits - prevCredits);
    }

    // Calculate credit differential vs cluster average
    const currentValidators = voteAccounts.current;
    if (currentValidators.length > 0 && ours.epochCredits.length > 0) {
      const [, ourCredits, ourPrev] = ours.epochCredits[ours.epochCredits.length - 1];
      const ourEpochCredits = ourCredits - ourPrev;

      const avgCredits = currentValidators.reduce((sum, v) => {
        if (v.epochCredits.length > 0) {
          const [, c, p] = v.epochCredits[v.epochCredits.length - 1];
          return sum + (c - p);
        }
        return sum;
      }, 0) / currentValidators.length;

      if (avgCredits > 0) {
        this.metrics.creditDifferential.set(ourEpochCredits / avgCredits);
      }
    }
  }

  private async collectBlockProduction(): Promise<void> {
    try {
      const production = await this.config.connection.getBlockProduction({
        identity: this.config.identity,
      });

      const stats = production.value.byIdentity[this.config.identity];
      if (stats) {
        const [leaderSlots, blocksProduced] = stats;
        const skipRate = leaderSlots > 0 ? (leaderSlots - blocksProduced) / leaderSlots : 0;

        this.metrics.leaderSlots.set(leaderSlots);
        this.metrics.blocksProduced.set(blocksProduced);
        this.metrics.skipRate.set(skipRate);
      }
    } catch (err) {
      // getBlockProduction can fail on some RPC providers
    }
  }

  private async collectEpochInfo(): Promise<void> {
    const epochInfo = await this.config.connection.getEpochInfo();
    this.metrics.currentEpoch.set(epochInfo.epoch);
    this.metrics.epochProgress.set(epochInfo.slotIndex / epochInfo.slotsInEpoch);
    this.metrics.currentSlot.set(epochInfo.absoluteSlot);

    // Detect epoch boundary
    if (epochInfo.epoch > this.lastEpoch && this.lastEpoch > 0) {
      this.metrics.epochTransitions.inc();
    }
    this.lastEpoch = epochInfo.epoch;
  }

  private async collectLeaderSchedule(): Promise<void> {
    try {
      const schedule = await this.config.connection.getLeaderSchedule();
      if (schedule && schedule[this.config.identity]) {
        const upcomingSlots = schedule[this.config.identity].length;
        this.metrics.upcomingLeaderSlots.set(upcomingSlots);
      }
    } catch {
      // Leader schedule may not be available for future epochs
    }
  }
}

class ValidatorMetrics {
  validatorActive: Gauge;
  activatedStake: Gauge;
  lastVote: Gauge;
  commission: Gauge;
  epochCredits: Gauge;
  creditDifferential: Gauge;
  leaderSlots: Gauge;
  blocksProduced: Gauge;
  skipRate: Gauge;
  currentEpoch: Gauge;
  epochProgress: Gauge;
  currentSlot: Gauge;
  epochTransitions: Counter;
  upcomingLeaderSlots: Gauge;

  constructor(registry: Registry) {
    this.validatorActive = new Gauge({ name: 'solana_validator_active', help: '1 if voting, 0 if delinquent', registers: [registry] });
    this.activatedStake = new Gauge({ name: 'solana_validator_stake_sol', help: 'Activated stake in SOL', registers: [registry] });
    this.lastVote = new Gauge({ name: 'solana_validator_last_vote_slot', help: 'Last vote slot', registers: [registry] });
    this.commission = new Gauge({ name: 'solana_validator_commission_pct', help: 'Commission percentage', registers: [registry] });
    this.epochCredits = new Gauge({ name: 'solana_validator_epoch_credits', help: 'Credits earned this epoch', registers: [registry] });
    this.creditDifferential = new Gauge({ name: 'solana_validator_credit_differential', help: 'Our credits / cluster average (1.0 = average)', registers: [registry] });
    this.leaderSlots = new Gauge({ name: 'solana_validator_leader_slots', help: 'Leader slots assigned this epoch', registers: [registry] });
    this.blocksProduced = new Gauge({ name: 'solana_validator_blocks_produced', help: 'Blocks successfully produced', registers: [registry] });
    this.skipRate = new Gauge({ name: 'solana_validator_skip_rate', help: 'Skip rate (0-1)', registers: [registry] });
    this.currentEpoch = new Gauge({ name: 'solana_epoch_current', help: 'Current epoch number', registers: [registry] });
    this.epochProgress = new Gauge({ name: 'solana_epoch_progress', help: 'Epoch progress (0-1)', registers: [registry] });
    this.currentSlot = new Gauge({ name: 'solana_slot_current', help: 'Current absolute slot', registers: [registry] });
    this.epochTransitions = new Counter({ name: 'solana_epoch_transitions_total', help: 'Epoch transitions observed', registers: [registry] });
    this.upcomingLeaderSlots = new Gauge({ name: 'solana_validator_upcoming_leader_slots', help: 'Leader slots in upcoming schedule', registers: [registry] });
  }
}
```

## Prometheus Alert Rules for Validators

```yaml
groups:
  - name: solana_validator_alerts
    rules:
      - alert: ValidatorDelinquent
        expr: solana_validator_active == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Validator is DELINQUENT -- not voting"
          runbook: "1. Check validator logs. 2. Verify network connectivity. 3. Check if restart needed."

      - alert: HighSkipRate
        expr: solana_validator_skip_rate > 0.05
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Validator skip rate is {{ $value | humanizePercentage }}"
          runbook: "Check system resources (CPU, RAM, IOPS). Verify leader schedule timing."

      - alert: LowCreditDifferential
        expr: solana_validator_credit_differential < 0.95
        for: 30m
        labels:
          severity: warning
        annotations:
          summary: "Vote credits at {{ $value | humanizePercentage }} of cluster average"

      - alert: StakeDropped
        expr: delta(solana_validator_stake_sol[1h]) < -1000
        labels:
          severity: warning
        annotations:
          summary: "Lost {{ $value | humanize }} SOL in stake in the last hour"

      - alert: EpochBoundaryApproaching
        expr: solana_epoch_progress > 0.95
        labels:
          severity: info
        annotations:
          summary: "Epoch boundary approaching ({{ $value | humanizePercentage }} complete)"
```

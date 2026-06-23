# Rule: Observability Code Patterns

## Required Patterns for Generated Code

### 1. Always Include Error Handling in Metrics Collection

```typescript
// ✅ CORRECT: Wrap metric collection in try/catch
try {
  const slot = await connection.getSlot();
  metrics.rpcLatency.observe({ status: 'success' }, latency);
} catch (err) {
  metrics.rpcLatency.observe({ status: 'error' }, latency);
  metrics.errors.inc({ type: classifyError(err) });
}

// ❌ WRONG: Unhandled promise rejection crashes the monitor
const slot = await connection.getSlot();
metrics.rpcLatency.observe(latency);
```

### 2. Always Use Labels Consistently

```typescript
// ✅ CORRECT: Same label set on every .observe() / .inc()
counter.inc({ method: 'getSlot', status: 'success' });
counter.inc({ method: 'getSlot', status: 'error' });

// ❌ WRONG: Missing labels create "no data" in Grafana
counter.inc({ method: 'getSlot' }); // missing 'status'
```

### 3. Always Guard Against Division by Zero in Rates

```promql
# ✅ CORRECT: Guard with > 0
sum(rate(landed[5m])) / (sum(rate(submitted[5m])) > 0)

# ❌ WRONG: Can produce NaN/Inf
sum(rate(landed[5m])) / sum(rate(submitted[5m]))
```

### 4. Always Use Exponential Backoff for Reconnections

```typescript
// ✅ CORRECT: Exponential backoff with jitter
const delay = Math.min(1000 * Math.pow(2, attempts) + Math.random() * 1000, maxDelay);

// ❌ WRONG: Fixed delay
await sleep(1000);
```

### 5. Always Set Timeouts on External Calls

```typescript
// ✅ CORRECT: Timeout on every RPC call
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);
try {
  await fetch(url, { signal: controller.signal });
} finally {
  clearTimeout(timeout);
}

// ❌ WRONG: No timeout (can hang forever)
await fetch(url);
```

### 6. Never Block the Metrics Collection Loop

```typescript
// ✅ CORRECT: Webhook fires asynchronously
if (shouldAlert) {
  sendWebhook(payload).catch(err => logger.warn('webhook failed', err));
}

// ❌ WRONG: Blocking webhook delays next metric collection
if (shouldAlert) {
  await sendWebhook(payload); // blocks!
}
```

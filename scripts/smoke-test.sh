#!/usr/bin/env bash
# smoke-test.sh — Verify the observability stack is working
# Usage: ./scripts/smoke-test.sh [--deploy] [--cleanup]
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAILURES=$((FAILURES + 1)); }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
info() { echo -e "       $1"; }

FAILURES=0
TOTAL=0

check() {
  TOTAL=$((TOTAL + 1))
  if eval "$2" > /dev/null 2>&1; then
    pass "$1"
  else
    fail "$1"
    info "  Command: $2"
  fi
}

echo "============================================="
echo " Solana Observability Skill — Smoke Test"
echo " Version: 2.0.0"
echo "============================================="
echo

# 1. File structure checks
echo "--- File Structure ---"
check "SKILL.md exists" "[ -f skill/SKILL.md ]"
check "12 skill files present" "[ $(ls skill/*.md 2>/dev/null | wc -l) -ge 12 ]"
check "3 agent files present" "[ $(ls agents/*.md 2>/dev/null | wc -l) -eq 3 ]"
check "3 command files present" "[ $(ls commands/*.md 2>/dev/null | wc -l) -eq 3 ]"
check "2 rule files present" "[ $(ls rules/*.md 2>/dev/null | wc -l) -eq 2 ]"
check "install.sh exists" "[ -f install.sh ]"
check "install.sh is executable" "[ -x install.sh ] || chmod +x install.sh"
check "package.json exists" "[ -f package.json ]"
check "tsconfig.json exists" "[ -f tsconfig.json ]"
check "docker-compose.yml exists" "[ -f deploy/docker-compose.yml ]"
check "prometheus.yml exists" "[ -f deploy/prometheus.yml ]"
check "alert rules exist" "[ -f deploy/alerting/solana-alerts.yml ]"
check "Grafana dashboard exists" "[ -f deploy/grafana/dashboards/solana-overview.json ]"
echo

# 2. Content validation
echo "--- Content Validation ---"
check "SKILL.md has version 2.0.0" "grep -q '2.0.0' skill/SKILL.md"
check "No TODO placeholders" "! grep -rq 'TODO\|FIXME\|PLACEHOLDER\|implement me' skill/ agents/ commands/ rules/"
check "No structlog in TypeScript" "! grep -q 'structlog' skill/distributed-tracing.md || grep -q 'pino' skill/distributed-tracing.md"
check "PublicKey imported in rpc-monitoring" "grep -q 'import.*PublicKey.*from' skill/rpc-monitoring.md"
check "pino used in distributed-tracing" "grep -q 'pino' skill/distributed-tracing.md"
check "MIT license" "grep -q 'MIT' LICENSE"
echo

# 3. JSON/YAML validity (if tools available)
echo "--- Config Validation ---"
if command -v node &> /dev/null; then
  check "package.json is valid JSON" "node -e 'JSON.parse(require(\"fs\").readFileSync(\"package.json\"))'"
  check "tsconfig.json is valid JSON" "node -e 'JSON.parse(require(\"fs\").readFileSync(\"tsconfig.json\"))'"
  check "Grafana dashboard is valid JSON" "node -e 'JSON.parse(require(\"fs\").readFileSync(\"deploy/grafana/dashboards/solana-overview.json\"))'"
else
  warn "Node.js not found — skipping JSON validation"
fi

if command -v docker &> /dev/null; then
  check "Docker available" "docker --version"
  if [ "${1:-}" = "--deploy" ]; then
    echo
    echo "--- Deploy Test ---"
    info "Starting stack..."
    cd deploy && docker compose up -d
    sleep 15
    check "Prometheus healthy" "curl -sf http://localhost:9090/-/healthy"
    check "Grafana healthy" "curl -sf http://localhost:3000/api/health"
    check "Exporter responding" "curl -sf http://localhost:9100/metrics | grep -q solana_rpc"
    if [ "${2:-}" = "--cleanup" ] || [ "${1:-}" = "--cleanup" ]; then
      info "Cleaning up..."
      docker compose down -v
    fi
    cd ..
  fi
else
  warn "Docker not found — skipping deploy test"
fi
echo

# 4. TypeScript compilation check
echo "--- TypeScript Check ---"
if command -v npx &> /dev/null && [ -f node_modules/.bin/tsc ] 2>/dev/null; then
  check "TypeScript compiles" "npx tsc --noEmit"
else
  warn "TypeScript compiler not installed — run 'npm install' first"
  info "  To verify: npm install && npm run typecheck"
fi
echo

# Summary
echo "============================================="
PASSED=$((TOTAL - FAILURES))
echo -e " Results: ${GREEN}${PASSED} passed${NC}, ${RED}${FAILURES} failed${NC}, ${TOTAL} total"
echo "============================================="

if [ $FAILURES -eq 0 ]; then
  echo -e "${GREEN}All checks passed! Stack is ready.${NC}"
  exit 0
else
  echo -e "${RED}${FAILURES} check(s) failed. Review above output.${NC}"
  exit 1
fi

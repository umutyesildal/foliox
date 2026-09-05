#!/usr/bin/env bash
# FolioX devnet demo stack — one command to (re)start everything cleanly.
#
#   bash scripts/devnet-up.sh          # restart backend + frontend
#   bash scripts/devnet-up.sh --check  # just health-check, restart nothing
#
# What it guarantees on success:
#   * backend  :3001  (indexer+NAV+fee-crank against devnet, .env.devnet)
#   * frontend :3100  (production build, devnet cluster)
#   * both verified by real HTTP health probes before it prints DONE
#
# Why this exists: nohup'd background servers were dying silently or leaving
# zombie listeners on the ports (the "site açılmıyor" incidents). This script
# kills by PORT (not by fragile process-name patterns), rebuilds only when
# sources changed, and starts fresh every time.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

APP_PORT=3100
API_PORT=3001
APP_DIR="$REPO_ROOT/app"
LOG_DIR=/tmp
CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

port_pid() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }

health_backend() { curl -s -m 5 "http://localhost:$API_PORT/api/v1/health" 2>/dev/null | grep -q '"ok":true'; }
health_app()    { [[ "$(curl -s -o /dev/null -w '%{http_code}' -m 8 "http://localhost:$APP_PORT/explore" 2>/dev/null)" == "200" ]]; }

if [[ $CHECK_ONLY -eq 1 ]]; then
  health_backend && echo "backend :$API_PORT  OK" || echo "backend :$API_PORT  DOWN"
  health_app    && echo "app     :$APP_PORT  OK" || echo "app     :$APP_PORT  DOWN"
  exit 0
fi

echo "== FolioX devnet stack =="

# ---- 1. kill whatever holds the ports (zombies included) ----
for port in $API_PORT $APP_PORT; do
  pid="$(port_pid "$port")"
  if [[ -n "$pid" ]]; then
    echo "port $port held by pid $pid — killing"
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
  fi
done

# ---- 2. backend ----
cd "$REPO_ROOT/backend"
set -a; . ./.env.devnet; set +a
nohup npx tsx src/index.ts > "$LOG_DIR/foliox-backend-devnet.log" 2>&1 &
echo $! > /tmp/foliox-backend-devnet-child.pid
ok=0
for _ in $(seq 1 30); do
  health_backend && ok=1 && break
  sleep 2
done
[[ $ok -eq 1 ]] && echo "backend :$API_PORT  UP ✓" || { echo "backend FAILED — tail of log:"; tail -20 "$LOG_DIR/foliox-backend-devnet.log"; exit 1; }

# ---- 3. frontend (production build; rebuild when sources newer than BUILD_ID) ----
cd "$APP_DIR"
if [[ ! -f .next/BUILD_ID ]] || [[ -n "$(find app components lib -name '*.ts*' -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]]; then
  echo "sources changed — rebuilding (production)…"
  rm -rf .next
  NEXT_PUBLIC_CLUSTER=devnet NEXT_PUBLIC_API="http://localhost:$API_PORT" npm run build > "$LOG_DIR/foliox-app-build.log" 2>&1
fi
NEXT_PUBLIC_CLUSTER=devnet NEXT_PUBLIC_API="http://localhost:$API_PORT" nohup npm start -- -p "$APP_PORT" > "$LOG_DIR/foliox-app-prod.log" 2>&1 &
ok=0
for _ in $(seq 1 20); do
  health_app && ok=1 && break
  sleep 2
done
[[ $ok -eq 1 ]] && echo "app     :$APP_PORT  UP ✓" || { echo "app FAILED — tail of log:"; tail -20 "$LOG_DIR/foliox-app-prod.log"; exit 1; }

echo ""
echo "DONE → http://localhost:$APP_PORT/explore  (backend :$API_PORT, 3 baskets expected)"

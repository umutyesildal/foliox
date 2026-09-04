#!/usr/bin/env bash
# FolioX localnet E2E — deterministic flow (plan.md G2 milestone / P9).
#
#   1. preflight        toolchain + program binaries present?
#   2. validator        fresh solana-test-validator ledger on 127.0.0.1:8899
#   3. deploy           deploy the 3 programs IF .so + keypairs exist
#   4. scripts          createWhitelist -> createBasket -> mintAndRedeem -> accrueFee
#   5. backend          health probe IF a backend is listening on :3001
#
# Every step prints PASS/FAIL; the exit code is non-zero if any step failed.
# Works from the repo root with the PATH from AGENTS.md §13:
#   export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
#
# KNOWN BLOCKERS (2026-09-01, see the localnet-E2E worker report):
#   B1 (SBF toolchain, AGENTS.md §20) — platform-tools v1.41 (rustc 1.75)
#      cannot compile the current Cargo.lock (crypto-common 0.2.2 and friends
#      need edition2024 / rustc >= 1.85), and its cargo cannot even parse the
#      lockfile: "lock file version 4 requires -Znext-lockfile-bump". Fix:
#      `sed -i '' 's/version = 4/version = 3/' Cargo.lock` + either pin the
#      drifted crates back to rustc-1.75-compatible releases or install a
#      newer platform-tools via `cargo build-sbf --tools-version v1.4x`.
#   B2 (program IDs, BLOCKS DEPLOY EVEN AFTER B1) — the declared program ids in
#      Anchor.toml are NOT deployable: sXShikYX7G5n3S3qp78RWQBxh2YJARLvufiCoaxjAyq
#      (factory) and 37VPGtd57kXJ1HvH1xvdZr1y3s4KXj9pP2o6GdYLgbb1 (basket) are
#      OFF-CURVE points, so no ed25519 deploy keypair can exist for them, and
#      no target/deploy/*-keypair.json is committed for the on-curve whitelist
#      id either. Deployment REQUIRES the programs to sit exactly at the
#      declared ids (whitelist::ID / basket::ID are compiled into the other
#      programs' cross-program checks), so a fix must change declare_id! in all
#      3 programs/*/src/lib.rs + Anchor.toml + AGENTS.md §14 env ids (programs/
#      owner action, out of the scripts worker's scope). Until then step 3
#      fails and steps 4.x fail on their first program call; the mock-mint
#      portion of createWhitelist (pure Token-2022) still runs and passes.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

RPC_PORT="${FOLIOX_E2E_RPC_PORT:-8899}"
RPC_URL="http://127.0.0.1:${RPC_PORT}"
export FOLIOX_E2E_RPC_URL="$RPC_URL"

STATE_DIR="$(mktemp -d -t foliox-e2e-state.XXXXXX)"
LEDGER_DIR="$(mktemp -d -t foliox-e2e-ledger.XXXXXX)"
LOG_DIR="${FOLIOX_E2E_LOG_DIR:-$STATE_DIR/logs}"
mkdir -p "$LOG_DIR"
export FOLIOX_E2E_STATE_DIR="$STATE_DIR"

VALIDATOR_PID=""
declare -a STEP_NAMES=()
declare -a STEP_RESULTS=()

cleanup() {
  if [[ -n "$VALIDATOR_PID" ]] && kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    kill "$VALIDATOR_PID" 2>/dev/null || true
    wait "$VALIDATOR_PID" 2>/dev/null || true
  fi
  if [[ "${FOLIOX_E2E_KEEP_STATE:-0}" != "1" ]]; then
    rm -rf "$STATE_DIR" "$LEDGER_DIR"
  else
    echo "kept state: $STATE_DIR  ledger: $LEDGER_DIR"
  fi
}
trap cleanup EXIT

record() { STEP_NAMES+=("$1"); STEP_RESULTS+=("$2"); }
summary() {
  echo ""
  echo "==================== E2E SUMMARY ===================="
  local i rc=0
  for i in "${!STEP_NAMES[@]}"; do
    printf "  %-55s %s\n" "${STEP_NAMES[$i]}" "${STEP_RESULTS[$i]}"
    [[ "${STEP_RESULTS[$i]}" == PASS* ]] || rc=1
  done
  echo "====================================================="
  if [[ $rc -eq 0 ]]; then echo "E2E RESULT: PASS"; else echo "E2E RESULT: FAIL"; fi
  exit $rc
}
fail_fast() { record "$1" "FAIL"; echo "FAIL: $1"; [[ -n "${2:-}" ]] && echo "  $2"; summary; }

echo "== FolioX localnet E2E =="
echo "repo:      $REPO_ROOT"
echo "rpc:       $RPC_URL"
echo "state dir: $STATE_DIR"
echo "programs:  whitelist FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS"
echo "           factory  3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF"
echo "           basket   6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k"

# ---------------- 1. preflight ----------------
STEP="preflight"
if command -v solana-test-validator >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  TSX_BIN="npx -y tsx"
  if npx --no-install tsx --version >/dev/null 2>&1; then
    TSX_BIN="npx tsx"
  fi
  record "$STEP" "PASS ($(solana-test-validator --version 2>&1 | head -1), node $(node --version), tsx via $TSX_BIN)"
  echo "PASS: $STEP"
else
  fail_fast "$STEP" "solana-test-validator and/or node not found — install solana 1.18.x and node >= 20"
fi

# ---------------- 2. validator (fresh ledger) ----------------
STEP="validator (fresh ledger)"
export COPYFILE_DISABLE=1  # macOS AppleDouble ._genesis.bin tar bug
if solana-test-validator \
     --ledger "$LEDGER_DIR" \
     --rpc-port "$RPC_PORT" \
     --quiet \
     >"$LOG_DIR/validator.log" 2>&1 &
then
  VALIDATOR_PID=$!
  ok=0
  for _ in $(seq 1 60); do
    if curl -s -m 2 -X POST "$RPC_URL" -H 'content-type: application/json' \
         -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | grep -q '"ok"'; then
      ok=1; break
    fi
    sleep 1
  done
  if [[ $ok -eq 1 ]]; then
    record "$STEP" "PASS (pid $VALIDATOR_PID, ledger $LEDGER_DIR)"
    echo "PASS: $STEP"
  else
    fail_fast "$STEP" "validator did not become healthy in 60s — see $LOG_DIR/validator.log"
  fi
else
  fail_fast "$STEP" "could not start solana-test-validator"
fi

# ---------------- 3. deploy (IF .so + keypairs exist) ----------------
STEP="deploy programs"
DEPLOY_READY=1
MISSING=""
for prog in whitelist basket_factory basket; do
  [[ -f "target/deploy/$prog.so" ]] || { MISSING="$MISSING target/deploy/$prog.so"; DEPLOY_READY=0; }
  [[ -f "target/deploy/$prog-keypair.json" ]] || { MISSING="$MISSING target/deploy/$prog-keypair.json"; DEPLOY_READY=0; }
done
if [[ $DEPLOY_READY -eq 0 ]]; then
  record "$STEP" "FAIL (missing:$MISSING — B1 SBF build not produced and/or B2 deploy keypairs absent, see header comments)"
  echo "FAIL: $STEP"
  echo "  blocked: program binaries/keypairs absent. Known blockers B1 (SBF toolchain) and B2 (declared program ids are off-curve -> undeployable; needs declare_id! regeneration) — see file header."
else
  KP_MISMATCH=0
  # bash-3.2 compatible (macOS stock bash): associative arrays unsupported.
  declared_id() {
    case "$1" in
      whitelist)      echo "FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS" ;;
      basket_factory) echo "3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF" ;;
      basket)         echo "6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k" ;;
    esac
  }
  for prog in whitelist basket_factory basket; do
    kp_addr="$(solana-keygen pubkey "target/deploy/$prog-keypair.json" 2>/dev/null || echo "")"
    if [[ "$kp_addr" != "$(declared_id "$prog")" ]]; then
      echo "  $prog keypair $kp_addr != declared $(declared_id "$prog")"
      KP_MISMATCH=1
    fi
  done
  if [[ $KP_MISMATCH -eq 1 ]]; then
    record "$STEP" "FAIL (deploy keypair addresses do not match the declared ids — programs must sit exactly at the declared ids; see B2)"
    echo "FAIL: $STEP"
  else
    solana airdrop 10 --url "$RPC_URL" >/dev/null 2>&1 || true
    DEPLOY_OK=1
    for prog in whitelist basket_factory basket; do
      if ! solana program deploy "target/deploy/$prog.so" \
            --program-id "target/deploy/$prog-keypair.json" \
            --url "$RPC_URL" \
            --keypair "${FOLIOX_E2E_PAYER_KEYPAIR:-$HOME/.config/solana/id.json}" \
            >"$LOG_DIR/deploy-$prog.log" 2>&1; then
        DEPLOY_OK=0
        echo "  deploy $prog failed — see $LOG_DIR/deploy-$prog.log"
      fi
    done
    if [[ $DEPLOY_OK -eq 1 ]]; then
      record "$STEP" "PASS"
      echo "PASS: $STEP"
    else
      record "$STEP" "FAIL (solana program deploy — see logs)"
      echo "FAIL: $STEP"
    fi
  fi
fi

# ---------------- 4. protocol scripts ----------------
export FOLIOX_E2E_PAYER="$STATE_DIR/payer.json"
# Independent treasury wallet so the 90/10 fee split is on-chain observable.
export FOLIOX_E2E_TREASURY="$STATE_DIR/treasury.json"
# Generate the treasury keypair up front: createBasket.ts loads it strictly
# via keypairFromFile (it never signs or holds SOL).
solana-keygen new --no-bip39-passphrase -o "$FOLIOX_E2E_TREASURY" --force --silent

# Generate the payer keypair up front (funded by the scripts themselves).
npx -y tsx -e 'import { payerKeypair } from "./scripts/lib.ts"; console.log("payer:", payerKeypair().publicKey.toBase58());' 2>&1 | tail -1

run_script() {
  local name="$1" file="$2"
  local step_name="script: $name"
  if $TSX_BIN "scripts/$file" >"$LOG_DIR/$name.log" 2>&1; then
    record "$step_name" "PASS"
    echo "PASS: $step_name"
    sed 's/^/    /' "$LOG_DIR/$name.log" | tail -30
  else
    record "$step_name" "FAIL (see $LOG_DIR/$name.log)"
    echo "FAIL: $step_name"
    sed 's/^/    /' "$LOG_DIR/$name.log" | tail -30
  fi
}

run_script createWhitelist createWhitelist.ts
run_script createBasket createBasket.ts
run_script mintAndRedeem mintAndRedeem.ts
run_script accrueFee accrueFee.ts

# ---------------- 5. backend health (IF running) ----------------
STEP="backend health (:3001)"
HEALTH="$(curl -s -m 2 http://localhost:3001/api/v1/health || true)"
if echo "$HEALTH" | grep -q '"ok"'; then
  record "$STEP" "PASS ($HEALTH)"
  echo "PASS: $STEP"
elif curl -s -m 2 http://localhost:3001/ >/dev/null 2>&1; then
  record "$STEP" "FAIL (backend listening but /api/v1/health not ok: $HEALTH)"
  echo "FAIL: $STEP"
else
  record "$STEP" "SKIP (no backend on :3001)"
  echo "SKIP: $STEP"
fi

summary

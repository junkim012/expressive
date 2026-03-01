#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# action.sh — Lender, borrower, and solver bots for local testing
#
# Starts two lender bots, one borrower bot, and one solver bot.
# Each actor logs to its own file AND to stdout with a colored prefix.
#
# Usage:   bash e2e/action.sh   OR   make action
# Stop:    Ctrl+C  (kills all bots cleanly)
# Logs:    tail -f /tmp/el-lenders.log
#          tail -f /tmp/el-borrower.log
#          tail -f /tmp/el-solver.log
#
# Requires: make dev already running
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
source "$(dirname "$0")/scenarios/_common.sh"

# ── Tunable ranges ────────────────────────────────────────────────────────────
# Lender
L_SLEEP_MIN=5           # seconds between lend orders
L_SLEEP_MAX=20
L_AMOUNT_MIN=50         # USDC
L_AMOUNT_MAX=500
L_RATE_MIN=200          # bps (2%)
L_RATE_MAX=600          # bps (6%)
L_LTV_MIN=5000          # bps (50%)
L_LTV_MAX=8000          # bps (80%)
L_LLTV_BUMP_MIN=500     # bps added on top of maxLTV
L_LLTV_BUMP_MAX=2000
L_DUR_MIN=7             # days
L_DUR_MAX=365

# Borrower
B_SLEEP_MIN=8
B_SLEEP_MAX=25
B_AMOUNT_MIN=50         # USDC
B_AMOUNT_MAX=300
B_RATE_MIN=400          # bps (4%)
B_RATE_MAX=800          # bps (8%)
B_LTV_MIN=3000          # bps (30%)
B_LTV_MAX=7000          # bps (70%)
B_LLTV_BUMP_MIN=500
B_LLTV_BUMP_MAX=2000
B_DUR_MIN=7             # days
B_DUR_MAX=180

# Oracle prices (must match LocalSetup.s.sol)
BTC_PRICE_USDC6=80000000000   # 80_000e6  — price * satoshis / 1e8  = USDC_6dec
ETH_PRICE_USDC6=3000000000    # 3_000e6   — price * wei     / 1e18 = USDC_6dec

# ── Log files ─────────────────────────────────────────────────────────────────
LENDERS_LOG=/tmp/el-lenders.log
BORROWER_LOG=/tmp/el-borrower.log
SOLVER_LOG=/tmp/el-solver.log

# Truncate log files on start
> "$LENDERS_LOG"
> "$BORROWER_LOG"
> "$SOLVER_LOG"

# ── Colors ────────────────────────────────────────────────────────────────────
# GREEN, RED, BLUE, YELLOW, BOLD, NC already set by _common.sh
CYAN='\033[0;36m'

# ── Per-actor log helpers ─────────────────────────────────────────────────────
# Each writes colored output to stdout and plain timestamped text to its log file.

llog() {  # lender: llog <label> <message>
  local label="$1" msg="$2"
  echo -e "  ${BLUE}[${label}]${NC} ${msg}"
  echo "[$(date '+%H:%M:%S')] [${label}] ${msg}" >> "$LENDERS_LOG"
}

blog() {  # borrower: blog <message>
  echo -e "  ${YELLOW}[BORROWER]${NC} $1"
  echo "[$(date '+%H:%M:%S')] [BORROWER] $1" >> "$BORROWER_LOG"
}

slog() {  # solver: slog <message>
  echo -e "  ${CYAN}[SOLVER]${NC} $1"
  echo "[$(date '+%H:%M:%S')] [SOLVER] $1" >> "$SOLVER_LOG"
}

# Format a unix timestamp as HH:MM:SS (macOS + Linux)
fmt_ts() {
  date -r "$1" "+%H:%M:%S" 2>/dev/null \
    || date -d "@$1" "+%H:%M:%S" 2>/dev/null \
    || echo "@$1"
}

# ── Cleanup ───────────────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  echo ""
  header "Stopping bots..."
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  ok "All bots stopped."
}
trap cleanup EXIT INT TERM

# ── Misc helpers ──────────────────────────────────────────────────────────────
rand_between() { echo $(( $1 + RANDOM % ($2 - $1 + 1) )); }

clamp() {
  local v=$1 lo=$2 hi=$3
  (( v < lo )) && echo "$lo" && return
  (( v > hi )) && echo "$hi" && return
  echo "$v"
}

# ── Lender bot ────────────────────────────────────────────────────────────────
lender_bot() {
  local label="$1" key="$2" addr="$3"
  llog "$label" "Bot started (pid $$)"

  while true; do
    sleep "$(rand_between "$L_SLEEP_MIN" "$L_SLEEP_MAX")"

    local amount=$(( $(rand_between "$L_AMOUNT_MIN" "$L_AMOUNT_MAX") * 1000000 ))
    local min_rate; min_rate=$(rand_between "$L_RATE_MIN" "$L_RATE_MAX")
    local max_ltv;  max_ltv=$(rand_between  "$L_LTV_MIN"  "$L_LTV_MAX")
    local max_lltv; max_lltv=$(clamp \
      $(( max_ltv + $(rand_between "$L_LLTV_BUMP_MIN" "$L_LLTV_BUMP_MAX") )) \
      $(( max_ltv + 1 )) 9500)
    local days; days=$(rand_between "$L_DUR_MIN" "$L_DUR_MAX")
    local max_dur=$(( days * 86400 ))

    local collateral
    case $(( RANDOM % 3 )) in
      0) collateral="[$WBTC]" ;;
      1) collateral="[$WETH]" ;;
      2) collateral="[$WBTC,$WETH]" ;;
    esac

    local bal; bal=$(token_balance "$USDC" "$addr")
    if (( bal < amount )); then
      llog "$label" "USDC balance too low ($(( bal / 1000000 )) < $(( amount / 1000000 ))), skipping"
      continue
    fi

    llog "$label" "→ $(( amount / 1000000 )) USDC | rate≥${min_rate}bps ltv≤${max_ltv}bps lltv≤${max_lltv}bps dur≤${days}d | collateral=${collateral}"

    local tx
    if tx=$(csend "$key" \
        "placeLendOrder(address,address[],uint256,uint256,uint256,uint256,uint256)" \
        "$USDC" "$collateral" "$min_rate" "$max_ltv" "$max_dur" "$max_lltv" "$amount" \
        2>/dev/null); then
      llog "$label" "✓ $tx"
    else
      llog "$label" "tx rejected (contract validation failed)"
    fi
  done
}

# ── Borrower bot ──────────────────────────────────────────────────────────────
borrower_bot() {
  blog "Bot started (pid $$)"

  while true; do
    sleep "$(rand_between "$B_SLEEP_MIN" "$B_SLEEP_MAX")"

    local amount=$(( $(rand_between "$B_AMOUNT_MIN" "$B_AMOUNT_MAX") * 1000000 ))
    local max_rate; max_rate=$(rand_between "$B_RATE_MIN" "$B_RATE_MAX")
    local min_ltv;  min_ltv=$(rand_between  "$B_LTV_MIN"  "$B_LTV_MAX")
    local min_lltv; min_lltv=$(clamp \
      $(( min_ltv + $(rand_between "$B_LLTV_BUMP_MIN" "$B_LLTV_BUMP_MAX") )) \
      $(( min_ltv + 1 )) 9000)
    local days; days=$(rand_between "$B_DUR_MIN" "$B_DUR_MAX")
    local min_dur=$(( days * 86400 ))

    # Minimum collateral value (USDC 6-dec) to satisfy min_ltv
    local collateral_value=$(( amount * 10000 / min_ltv ))

    local collateral_assets collateral_amounts collateral_label
    case $(( RANDOM % 2 )) in
      0)
        # WBTC: satoshis = collateral_value / 800  (1e8 / 80_000e6 = 1/800)
        local wbtc_amount=$(( collateral_value / 800 + 10000 ))
        local wbtc_bal; wbtc_bal=$(token_balance "$WBTC" "$BORROWER")
        if (( wbtc_bal < wbtc_amount )); then
          blog "WBTC balance too low, skipping"
          continue
        fi
        collateral_assets="[$WBTC]"
        collateral_amounts="[$wbtc_amount]"
        collateral_label="WBTC(${wbtc_amount}sat)"
        ;;
      1)
        # WETH: wei = collateral_value * 1e9 / 3  (1e18 / 3_000e6 = 1e9/3)
        # Max intermediate: 1e9 * 1e9 = 1e18 — fits int64 (max 9.22e18)
        local weth_amount=$(( collateral_value * 1000000000 / 3 + 100000000000000 ))
        local weth_bal; weth_bal=$(token_balance "$WETH" "$BORROWER")
        # Use bc: weth_bal ~5e19 (50 ETH) overflows bash int64
        if [[ "$(echo "$weth_bal < $weth_amount" | bc)" == "1" ]]; then
          blog "WETH balance too low, skipping"
          continue
        fi
        collateral_assets="[$WETH]"
        collateral_amounts="[$weth_amount]"
        collateral_label="WETH(${weth_amount}wei)"
        ;;
    esac

    blog "→ $(( amount / 1000000 )) USDC | rate≤${max_rate}bps ltv≥${min_ltv}bps lltv≥${min_lltv}bps dur≥${days}d | collateral=${collateral_label}"

    local tx
    if tx=$(csend "$BORROWER_KEY" \
        "placeBorrowOrder(address,address[],uint256[],uint256,uint256,uint256,uint256,uint256,bool)" \
        "$USDC" "$collateral_assets" "$collateral_amounts" \
        "$max_rate" "$min_ltv" "$min_dur" "$min_lltv" "$amount" "false" \
        2>/dev/null); then
      blog "✓ $tx"
    else
      blog "tx rejected (contract validation failed)"
    fi
  done
}

# ── Solver bot ────────────────────────────────────────────────────────────────
# Each loop:
#   1. Reads window state from chain — logs when a new window opens.
#   2. Fetches open orders and finds all compatible pairs.
#   3. Logs every candidate pair (lend×borrow, spread, amount, surplus).
#   4. Submits the highest-surplus pair via submitBatch().
#      submitBatch auto-executes the previous window if it has expired.
#   5. If no pairs exist and the window has expired, calls executeBatch()
#      directly to advance the window.
solver_bot() {
  local last_window_id=-1
  slog "Solver bot started (pid $$)"

  while true; do
    sleep "$(rand_between 3 8)"

    # ── Read window state from chain ───────────────────────────────────────
    local window_id window_start window_secs window_end now
    window_id=$(   cast call "$CONTRACT_ADDRESS" "windowId()(uint256)"          --rpc-url "$RPC_URL" 2>/dev/null | tr -d '\n')
    window_start=$(cast call "$CONTRACT_ADDRESS" "windowStart()(uint256)"        --rpc-url "$RPC_URL" 2>/dev/null | tr -d '\n')
    window_secs=$( cast call "$CONTRACT_ADDRESS" "batchWindowSeconds()(uint256)" --rpc-url "$RPC_URL" 2>/dev/null | tr -d '\n')
    window_end=$(( window_start + window_secs ))
    now=$(date +%s)

    # Log whenever a new window opens
    if [[ "$window_id" != "$last_window_id" ]]; then
      slog "┌─ Window #${window_id} | opened $(fmt_ts "$window_start") | closes $(fmt_ts "$window_end") (${window_secs}s)"
      last_window_id="$window_id"
    fi

    # ── Fetch open orders and find all compatible pairs ────────────────────
    local orders
    orders=$(curl -sf "http://localhost:3002/api/v1/orders?status=open" 2>/dev/null \
      || echo '{"orders":[]}')

    local n_lend n_borrow
    n_lend=$(  echo "$orders" | jq '[.orders[] | select(.orderType=="lend")]   | length')
    n_borrow=$(echo "$orders" | jq '[.orders[] | select(.orderType=="borrow")] | length')

    local all_pairs
    all_pairs=$(echo "$orders" | jq -c '
      (.orders | map(select(.orderType=="lend")))   as $lends  |
      (.orders | map(select(.orderType=="borrow"))) as $borrows |
      [
        $borrows[] as $b |
        $lends[]   as $l |
        select(($l.minRate      | tonumber) <= ($b.maxRate      | tonumber)) |
        select(($l.maxLtv       | tonumber) >= ($b.minLtv       | tonumber)) |
        select(($l.maxDuration  | tonumber) >= ($b.minDuration  | tonumber)) |
        select(($l.maxLltv      | tonumber) >= ($b.minLltv      | tonumber)) |
        select(
          ($b.collateralAssets    | map(ascii_downcase)) as $bc |
          ($l.acceptableCollateral | map(ascii_downcase)) as $la |
          ($bc | map(. as $x | $la | any(. == $x)) | any)
        ) |
        (($l.amount | tonumber) - ($l.filledAmount | tonumber)) as $lr |
        (($b.amount | tonumber) - ($b.filledAmount | tonumber)) as $br |
        select($lr > 0 and $br > 0) |
        (if $lr < $br then $lr else $br end) as $match |
        {
          lendId:     ($l.orderId | tonumber),
          borrowId:   ($b.orderId | tonumber),
          lendRate:   ($l.minRate | tonumber),
          borrowRate: ($b.maxRate | tonumber),
          amount:     $match,
          surplus:    ((($b.maxRate | tonumber) - ($l.minRate | tonumber)) * $match)
        }
      ] | sort_by(-.surplus)
    ')

    local n_pairs
    n_pairs=$(echo "$all_pairs" | jq 'length')

    # ── No compatible pairs ────────────────────────────────────────────────
    if (( n_pairs == 0 )); then
      slog "│  No compatible pairs  (${n_lend} lend / ${n_borrow} borrow orders open)"

      if (( now >= window_end )); then
        slog "│  Window #${window_id} expired at $(fmt_ts "$window_end") — no winner, executing"
        local tx
        if tx=$(cast send "$CONTRACT_ADDRESS" "executeBatch()" \
            --rpc-url "$RPC_URL" --private-key "$SOLVER_KEY" \
            --json 2>/dev/null | jq -r '.transactionHash'); then
          slog "└─ executeBatch  $tx"
        fi
      fi
      continue
    fi

    # ── Log every candidate pair ───────────────────────────────────────────
    slog "│  ${n_pairs} compatible pair(s) from ${n_lend} lend / ${n_borrow} borrow orders:"
    local i
    for (( i=0; i<n_pairs; i++ )); do
      local pair lid bid lrate brate pamount psurplus spread
      pair=$(     echo "$all_pairs" | jq ".[$i]")
      lid=$(      echo "$pair" | jq -r '.lendId')
      bid=$(      echo "$pair" | jq -r '.borrowId')
      lrate=$(    echo "$pair" | jq -r '.lendRate')
      brate=$(    echo "$pair" | jq -r '.borrowRate')
      pamount=$(  echo "$pair" | jq -r '.amount')
      psurplus=$( echo "$pair" | jq -r '.surplus')
      spread=$(( brate - lrate ))
      local marker="   "; [[ $i -eq 0 ]] && marker="★  "
      slog "│  ${marker}[${i}] lend=#${lid}(${lrate}bps) × borrow=#${bid}(${brate}bps) | spread=${spread}bps | amount=$(( pamount / 1000000 ))USDC | surplus=${psurplus}"
    done

    # ── Submit best pair (index 0 = highest surplus) ───────────────────────
    local best lend_id borrow_id match_amount surplus
    best=$(       echo "$all_pairs" | jq -c '.[0]')
    lend_id=$(    echo "$best" | jq -r '.lendId')
    borrow_id=$(  echo "$best" | jq -r '.borrowId')
    match_amount=$(echo "$best" | jq -r '.amount')
    surplus=$(    echo "$best" | jq -r '.surplus')

    local pairs="[($lend_id,$borrow_id,$match_amount)]"
    local consumptions
    if (( lend_id < borrow_id )); then
      consumptions="[($lend_id,$match_amount),($borrow_id,$match_amount)]"
    else
      consumptions="[($borrow_id,$match_amount),($lend_id,$match_amount)]"
    fi

    slog "│  Submitting: lend=#${lend_id} × borrow=#${borrow_id} | surplus=${surplus}"

    local tx
    if tx=$(cast send "$CONTRACT_ADDRESS" \
        "submitBatch((uint256,uint256,uint256)[],(uint256,uint256)[])" \
        "$pairs" "$consumptions" \
        --rpc-url "$RPC_URL" --private-key "$SOLVER_KEY" \
        --json 2>/dev/null | jq -r '.transactionHash'); then
      slog "│  submitBatch  $tx"

      # submitBatch auto-executes the old window when called after expiry.
      # Detect this by checking if windowId incremented.
      local new_window_id
      new_window_id=$(cast call "$CONTRACT_ADDRESS" "windowId()(uint256)" \
        --rpc-url "$RPC_URL" 2>/dev/null | tr -d '\n')
      if [[ "$new_window_id" != "$window_id" ]]; then
        slog "└─ Window #${window_id} closed at $(fmt_ts "$window_end") (auto-executed by submitBatch)"
      fi
    else
      slog "│  submitBatch rejected (surplus not higher than current winner)"

      # If the window has also expired, execute it directly
      if (( now >= window_end )); then
        slog "│  Window #${window_id} expired at $(fmt_ts "$window_end") — executing"
        if tx=$(cast send "$CONTRACT_ADDRESS" "executeBatch()" \
            --rpc-url "$RPC_URL" --private-key "$SOLVER_KEY" \
            --json 2>/dev/null | jq -r '.transactionHash'); then
          slog "└─ executeBatch  $tx"
        fi
      fi
    fi

  done
}

# ── Launch ────────────────────────────────────────────────────────────────────
echo ""
header "Expressive Lending — activity bots"
echo ""
info "Lender sleep:    ${L_SLEEP_MIN}-${L_SLEEP_MAX}s | amount: ${L_AMOUNT_MIN}-${L_AMOUNT_MAX} USDC | rate: ${L_RATE_MIN}-${L_RATE_MAX}bps"
info "Borrower sleep:  ${B_SLEEP_MIN}-${B_SLEEP_MAX}s | amount: ${B_AMOUNT_MIN}-${B_AMOUNT_MAX} USDC | rate: ${B_RATE_MIN}-${B_RATE_MAX}bps"
info "Solver sleep:    3-8s"
echo ""
info "Checking backend..."
wait_for_backend
echo ""
info "Logs:"
info "  tail -f $LENDERS_LOG"
info "  tail -f $BORROWER_LOG"
info "  tail -f $SOLVER_LOG"
echo ""

lender_bot  "Lender1"  "$LENDER1_KEY"  "$LENDER1"  &
PIDS+=($!)

lender_bot  "Lender2"  "$LENDER2_KEY"  "$LENDER2"  &
PIDS+=($!)

borrower_bot &
PIDS+=($!)

solver_bot &
PIDS+=($!)

ok "All bots running. Press Ctrl+C to stop."
echo ""

wait

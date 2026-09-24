#!/usr/bin/env bash
# Runs every gate in SPEC §5. Each gate is gates/<id>.mjs and is run twice:
#   node gates/<id>.mjs --negative   must exit non-zero (the negative fixture is caught)
#   node gates/<id>.mjs              must exit zero
# A gate is green only when both hold (D11). G6 is advisory (D12).
# Usage: ./verify.sh            all gates
#        ./verify.sh g2a g3     just those
set -u
cd "$(dirname "$0")"

REQUIRED=(g0 g1 g2a g2b g2c g3 g4 g5)
ADVISORY=(g6)
if [ $# -gt 0 ]; then SELECTED=("$@"); else SELECTED=("${REQUIRED[@]}" "${ADVISORY[@]}"); fi

mkdir -p .verify
fail=0
summary=""
for id in "${SELECTED[@]}"; do
  script="gates/$id.mjs"
  advisory=0
  for a in "${ADVISORY[@]}"; do [ "$a" = "$id" ] && advisory=1; done

  if [ ! -f "$script" ]; then
    status="FAIL (not implemented)"
  else
    echo "=== $id: negative fixture ==="
    node "$script" --negative > ".verify/$id.neg.log" 2>&1
    neg=$?
    tail -5 ".verify/$id.neg.log"
    echo "=== $id: real run ==="
    node "$script" > ".verify/$id.log" 2>&1
    pos=$?
    tail -15 ".verify/$id.log"
    if [ $neg -eq 0 ]; then status="FAIL (negative fixture passed — gate cannot detect failure)"
    elif [ $pos -ne 0 ]; then status="FAIL"
    else status="PASS"; fi
  fi

  if [ $advisory -eq 1 ]; then status="$status (advisory)"
  elif [ "${status%% *}" != "PASS" ]; then fail=1; fi
  summary+="$(printf '%-4s %s' "$id" "$status")"$'\n'
done

echo
echo "===== verify.sh summary ====="
printf '%s' "$summary"
if [ $fail -ne 0 ]; then echo "RED"; elif [ $# -gt 0 ]; then echo "SELECTED GATES GREEN (run ./verify.sh with no arguments for DONE)"; else echo "ALL REQUIRED GATES GREEN"; fi
exit $fail

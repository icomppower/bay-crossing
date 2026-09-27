#!/usr/bin/env bash
# Runs every gate in SPEC §5 with the Harbor Engine gate runner (gate list: gates/gates.json).
#   ./verify.sh            all gates
#   ./verify.sh g2a g3     just those
cd "$(dirname "$0")" && exec node_modules/harbor-engine/gates/verify.sh "$@"

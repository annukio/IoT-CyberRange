#!/bin/bash
# launch.sh - Switch the lab to a given scenario state: main;y starting at s0
# Usage: ./launch.sh s0 | s1 | s2 | s3

set -e

SCENARIO=$1
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIOS_DIR="$SCRIPT_DIR/scenarios"
COMPOSE_FILE="$SCENARIOS_DIR/$SCENARIO/docker-compose.yml"

# --- Validate input ---
if [[ -z "$SCENARIO" ]]; then
  echo "[ERROR] No scenario specified. Usage: ./launch.sh s0"
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "[ERROR] No compose file found for scenario '$SCENARIO' at $COMPOSE_FILE"
  exit 1
fi

echo "[*] Tearing down current environment..."
# Find and stop any currently running scenario
for dir in "$SCENARIOS_DIR"/*/; do
  if [[ -f "$dir/docker-compose.yml" ]]; then
    docker compose -f "$dir/docker-compose.yml" down 2>/dev/null || true
  fi
done

echo "[*] Launching scenario: $SCENARIO"
docker compose -f "$COMPOSE_FILE" up -d --build

echo "[✓] Scenario $SCENARIO is live."
#!/bin/bash
# launch.sh - Manage lab scenario containers
# Usage:
#   ./launch.sh s0 | s1 | s2 | s3   Start a scenario (tears down any running one first)
#   ./launch.sh down                 Tear down all running scenario containers

set -e

SCENARIO=$1
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIOS_DIR="$SCRIPT_DIR/scenarios"

# --- Tear down all running scenarios ---
teardown_all() {
  echo "[*] Tearing down all running scenario containers..."
  for dir in "$SCENARIOS_DIR"/*/; do
    if [[ -f "$dir/docker-compose.yml" ]]; then
      docker compose -f "$dir/docker-compose.yml" down --remove-orphans 2>/dev/null || true
    fi
  done
  echo "[✓] All containers stopped."
}

# --- Handle 'down' command ---
if [[ "$SCENARIO" == "down" ]]; then
  teardown_all
  exit 0
fi

# --- Validate scenario input ---
if [[ -z "$SCENARIO" ]]; then
  echo "[ERROR] No argument specified."
  echo "Usage:"
  echo "  ./launch.sh s0 | s1 | s2 | s3   Start a scenario"
  echo "  ./launch.sh down                 Stop all containers"
  exit 1
fi

COMPOSE_FILE="$SCENARIOS_DIR/$SCENARIO/docker-compose.yml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "[ERROR] No compose file found for scenario '$SCENARIO' at $COMPOSE_FILE"
  exit 1
fi

teardown_all

echo "[*] Launching scenario: $SCENARIO"
docker compose -f "$COMPOSE_FILE" up -d --build

echo "[✓] Scenario $SCENARIO is live."
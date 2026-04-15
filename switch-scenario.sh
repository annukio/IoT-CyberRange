#!/bin/bash
# switch-scenario.sh - Tear down the current scenario and bring up the target one.
# Alias / wrapper around launch.sh for convenience.
#
# Usage:
#   ./switch-scenario.sh s0    # Flat, insecure baseline
#   ./switch-scenario.sh s1    # Network segmentation applied
#   ./switch-scenario.sh s2    # Legacy OS hardened (tbd)
#   ./switch-scenario.sh s3    # IoT API authenticated (tbd)

set -e

SCENARIO=$1
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/scenarios/$SCENARIO/docker-compose.yml"

if [ -z "$SCENARIO" ]; then
  echo "Usage: $0 <scenario>"
  echo "Available: s0, s1"
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Error: compose file not found at $COMPOSE_FILE"
  exit 1
fi

echo ""
echo "============================================"
echo "  Switching to scenario: $SCENARIO"
echo "============================================"
echo ""

# Tear down any currently running scenario
echo "[1/3] Tearing down current environment..."
for dir in "$SCRIPT_DIR/scenarios"/*/; do
  if [[ -f "$dir/docker-compose.yml" ]]; then
    docker compose -f "$dir/docker-compose.yml" down --remove-orphans 2>/dev/null || true
  fi
done

# Bring up the target scenario
echo "[2/3] Starting $SCENARIO environment..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo "[3/3] Done! Management platform available at http://localhost:3000"
echo ""
echo "Active scenario : $SCENARIO"
echo "Compose file    : $COMPOSE_FILE"

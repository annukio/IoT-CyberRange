#!/bin/bash
# switch-scenario.sh - Tear down current environment and
# bring up the target scenario state.
#
# Usage:
#   ./switch-scenario.sh s0    # Flat, insecure baseline
#   ./switch-scenario.sh s1    # Network segmentation applied
#   ./switch-scenario.sh s2    # Legacy OS hardened (tbd)
#   ./switch-scenario.sh s3    # IoT API authenticated (tbd)

set -e

SCENARIO=$1
COMPOSE_FILE="docker-compose.${SCENARIO}.yml"

if [ -z "$SCENARIO" ]; then
  echo "Usage: $0 <scenario>"
  echo "Available: s0, s1"
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Error: $COMPOSE_FILE not found."
  exit 1
fi

echo ""
echo "============================================"
echo "  Switching to scenario: $SCENARIO"
echo "============================================"
echo ""

# Tear down whatever is currently running (any compose file)
echo "[1/3] Tearing down current environment..."
for f in docker-compose.s*.yml; do
  docker compose -f "$f" down --remove-orphans 2>/dev/null || true
done

# Small pause to let Docker clean up networking
sleep 2

# Bring up the new scenario
echo "[2/3] Starting $SCENARIO environment..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo "[3/3] Done! Management platform available at http://localhost:3000"
echo ""
echo "Active scenario: $SCENARIO"
echo "Compose file:    $COMPOSE_FILE"

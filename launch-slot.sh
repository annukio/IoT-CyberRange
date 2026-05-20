#!/usr/bin/env bash
# launch-slot.sh — Start or stop an isolated lab slot on this host.
#
# Usage:
#   ./launch-slot.sh <1|2|3>        Start slot (port 808N, containers slot N_*)
#   ./launch-slot.sh <1|2|3> down   Tear down slot without touching other slots
#
# Each slot gets:
#   - Its own Docker project (COMPOSE_PROJECT_NAME=slotN)
#   - Its own port (slot1→8081, slot2→8082, slot3→8083)
#   - Its own progress file (/srv/slots/slotN/progress.json)
#   - Prefixed container names (slot1_corporate_ws, slot1_firewall, …)
#
# Environment variables passed to docker compose:
#   SLOT_PREFIX    — "slot1" / "slot2" / "slot3"  (read by server.js for container names)
#   SLOT_OCTET     — "1" / "2" / "3"              (third octet of every subnet/IP, read by both)
#   CNAME_PREFIX   — "slot1_" / …                 (read by docker-compose for container_name)
#   APP_PORT       — host port exposed by management_app
#   PROGRESS_FILE  — absolute path to the slot's progress.json on the host

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    echo "Usage: $(basename "$0") <1|2|3> [down]" >&2
    exit 1
}

[[ $# -lt 1 ]] && usage

N=$1
ACTION=${2:-up}

if [[ ! "$N" =~ ^[123]$ ]]; then
    echo "[ERROR] Slot number must be 1, 2, or 3." >&2
    exit 1
fi

if [[ "$ACTION" != "up" && "$ACTION" != "down" ]]; then
    echo "[ERROR] Optional second argument must be 'down' (omit for up)." >&2
    exit 1
fi

SLOT_DIR="/srv/slots/slot${N}"
PROGRESS_FILE="${SLOT_DIR}/progress.json"
APP_PORT="808${N}"
SLOT_PREFIX="slot${N}"
SLOT_OCTET="$N"
CNAME_PREFIX="slot${N}_"   # includes the separator used in container names
COMPOSE_FILE="${SCRIPT_DIR}/scenarios/s0/docker-compose.yml"
PROJECT_NAME="slot${N}"

compose_env() {
    env \
        COMPOSE_PROJECT_NAME="$PROJECT_NAME" \
        APP_PORT="$APP_PORT" \
        PROGRESS_FILE="$PROGRESS_FILE" \
        SLOT_PREFIX="$SLOT_PREFIX" \
        CNAME_PREFIX="$CNAME_PREFIX"
}

if [[ "$ACTION" == "down" ]]; then
    echo "[*] Tearing down slot${N}..."
    COMPOSE_PROJECT_NAME="$PROJECT_NAME" \
    APP_PORT="$APP_PORT" \
    PROGRESS_FILE="$PROGRESS_FILE" \
    SLOT_PREFIX="$SLOT_PREFIX" \
    SLOT_OCTET="$SLOT_OCTET" \
    CNAME_PREFIX="$CNAME_PREFIX" \
    docker compose -f "$COMPOSE_FILE" down --remove-orphans
    echo "[*] slot${N} stopped."
    exit 0
fi

# Ensure per-slot directory and a fresh progress file exist.
mkdir -p "$SLOT_DIR"
if [[ ! -f "$PROGRESS_FILE" ]]; then
    cp "${SCRIPT_DIR}/management_platform/progress.json" "$PROGRESS_FILE"
fi

echo "[*] Launching slot${N} on port ${APP_PORT}..."
COMPOSE_PROJECT_NAME="$PROJECT_NAME" \
APP_PORT="$APP_PORT" \
PROGRESS_FILE="$PROGRESS_FILE" \
SLOT_PREFIX="$SLOT_PREFIX" \
SLOT_OCTET="$SLOT_OCTET" \
CNAME_PREFIX="$CNAME_PREFIX" \
docker compose -f "$COMPOSE_FILE" up -d --build
echo "[*] slot${N} is live at http://localhost:${APP_PORT}"

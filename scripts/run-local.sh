#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/run-local.sh <image-directory> [output-directory]

Environment:
  HOST=127.0.0.1              Bind host. Use 0.0.0.0 for same-Wi-Fi phone access.
  PORT=3000                   Server port.
  ANNOTATOR_PASSWORD=...      Optional basic-auth password.
  ANNOTATIONS_DB=...          Optional SQLite DB path.
  ANNOTATIONS_CSV=...         Optional CSV export path.

Examples:
  scripts/run-local.sh "$HOME/Desktop/batch_images"
  ANNOTATOR_PASSWORD="change-me" scripts/run-local.sh "$HOME/Desktop/batch_images" "$HOME/Desktop/annotator-output"
  HOST=0.0.0.0 scripts/run-local.sh "$HOME/Desktop/batch_images"
EOF
}

if [[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

DATA_DIR="$1"
if [[ ! -d "$DATA_DIR" ]]; then
  echo "Image directory does not exist: $DATA_DIR" >&2
  exit 1
fi

OUTPUT_DIR="${2:-$ROOT_DIR/run-data}"
mkdir -p "$OUTPUT_DIR"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"
DB_PATH="${ANNOTATIONS_DB:-$OUTPUT_DIR/annotations.sqlite}"
CSV_PATH="${ANNOTATIONS_CSV:-$OUTPUT_DIR/annotations.csv}"

args=(
  --data "$DATA_DIR"
  --db "$DB_PATH"
  --save "$CSV_PATH"
  --host "$HOST"
  --port "$PORT"
)

if [[ -n "${ANNOTATOR_PASSWORD:-}" ]]; then
  args+=(--password "$ANNOTATOR_PASSWORD")
fi

echo "Image directory: $DATA_DIR"
echo "SQLite DB:       $DB_PATH"
echo "CSV export:      $CSV_PATH"
echo "Bind address:    $HOST:$PORT"

exec node --no-warnings "$ROOT_DIR/server.js" "${args[@]}"

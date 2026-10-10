#!/bin/bash

# Start a locally trusted HTTPS server for testing Service Worker behavior from
# phones on the same Wi-Fi network. Run `mkcert -install` once beforehand.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v mkcert >/dev/null 2>&1; then
    echo "mkcert is required. Install it with: brew install mkcert"
    exit 1
fi
if [ ! -d "backend/venv" ]; then
    echo "Python virtual environment missing; run ./start-local.sh once first."
    exit 1
fi

LOCAL_HTTPS_IP="${LOCAL_HTTPS_IP:-$(ipconfig getifaddr en0 2>/dev/null || true)}"
if [ -z "$LOCAL_HTTPS_IP" ]; then
    LOCAL_HTTPS_IP=$(ifconfig | awk '/inet (192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/ { print $2; exit }')
fi
if [ -z "$LOCAL_HTTPS_IP" ]; then
    echo "Could not determine the Wi-Fi IP. Retry with LOCAL_HTTPS_IP=<your LAN IP> ./start-local-https.sh"
    exit 1
fi

CERT_DIR="$SCRIPT_DIR/.local-certs"
CERT_FILE="$CERT_DIR/kids-chores-local.pem"
KEY_FILE="$CERT_DIR/kids-chores-local-key.pem"
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
    echo "Creating a local certificate for $LOCAL_HTTPS_IP..."
    mkcert -cert-file "$CERT_FILE" -key-file "$KEY_FILE" "$LOCAL_HTTPS_IP" localhost 127.0.0.1 ::1
fi

ENV_LOCAL="backend/.env.local"
if [ ! -f "$ENV_LOCAL" ] || ! grep -q '^FLASK_SECRET_KEY=' "$ENV_LOCAL"; then
    GEN_KEY=$(backend/venv/bin/python -c 'import secrets; print(secrets.token_hex(32))')
    printf 'FLASK_SECRET_KEY=%s\n' "$GEN_KEY" >> "$ENV_LOCAL"
    chmod 600 "$ENV_LOCAL"
fi
set -a
. "$ENV_LOCAL"
set +a

HTTPS_PORT="${HTTPS_PORT:-5443}"
HTTPS_LOG_FILE="${HTTPS_LOG_FILE:-/tmp/kids-chores-local-https.log}"
if lsof -Pi ":$HTTPS_PORT" -sTCP:LISTEN -t >/dev/null; then
    echo "Port $HTTPS_PORT is already in use."
    exit 1
fi

echo "HTTPS local URL: https://$LOCAL_HTTPS_IP:$HTTPS_PORT"
echo "Request log: $HTTPS_LOG_FILE"
echo "On iPhone, first install and trust this Mac's mkcert root certificate."
echo "Press Ctrl+C to stop."
: > "$HTTPS_LOG_FILE"

cd backend
export PYTHONPATH=.
export FLASK_ENV=development
LOCAL_HTTPS_CERT="$CERT_FILE" LOCAL_HTTPS_KEY="$KEY_FILE" HTTPS_PORT="$HTTPS_PORT" \
    venv/bin/python -c '
import os
from src.app import create_app
app = create_app()
app.run(host="0.0.0.0", port=int(os.environ["HTTPS_PORT"]), debug=False, use_reloader=False,
        ssl_context=(os.environ["LOCAL_HTTPS_CERT"], os.environ["LOCAL_HTTPS_KEY"]))
' 2>&1 | tee -a "$HTTPS_LOG_FILE"

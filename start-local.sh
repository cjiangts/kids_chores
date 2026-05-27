#!/bin/bash

# Start Local Development Server
# Usage: ./start-local.sh

echo "🚀 Starting Kids Learning App (Local Development)"
echo "================================================"

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if virtual environment exists
if [ ! -d "backend/venv" ]; then
    echo "❌ Virtual environment not found!"
    echo "Creating virtual environment..."
    cd backend
    python3 -m venv venv
    source venv/bin/activate
    echo "📦 Installing dependencies..."
    pip install -r requirements.txt
    cd ..
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source backend/venv/bin/activate

# Ensure backend/.env.local holds a FLASK_SECRET_KEY so sessions survive
# server restarts. Generated once, then reused on every subsequent start.
ENV_LOCAL="backend/.env.local"
if [ ! -f "$ENV_LOCAL" ] || ! grep -q '^FLASK_SECRET_KEY=' "$ENV_LOCAL"; then
    echo "🔑 Generating FLASK_SECRET_KEY in $ENV_LOCAL (first run)..."
    GEN_KEY=$(python -c 'import secrets; print(secrets.token_hex(32))')
    printf 'FLASK_SECRET_KEY=%s\n' "$GEN_KEY" >> "$ENV_LOCAL"
    chmod 600 "$ENV_LOCAL"
fi
set -a
. "$ENV_LOCAL"
set +a

# Navigate to backend directory
cd backend

# Check if port 5001 is already in use
if lsof -Pi :5001 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  Port 5001 is already in use!"
    echo "Stopping existing process..."
    lsof -ti:5001 | xargs kill -9 2>/dev/null
    sleep 1
fi

# Start the Flask app
echo ""
echo "✅ Starting Flask server..."
echo "📍 Local URL: http://localhost:5001"
echo "📍 Network URL: http://$(ipconfig getifaddr en0 2>/dev/null || echo "localhost"):5001"
echo ""
echo "Press Ctrl+C to stop the server"
echo "================================================"
echo ""

# Set environment variables and run
export PYTHONPATH=.
export FLASK_ENV=development
python src/app.py

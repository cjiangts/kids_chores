#!/bin/bash

# Stop Local Development Server
# Usage: ./stop-local.sh

echo "🛑 Stopping Kids Learning App..."

# Kill any process using port 5001
if lsof -Pi :5001 -sTCP:LISTEN -t >/dev/null ; then
    echo "Found Flask server on port 5001"
    lsof -ti:5001 | xargs kill -9 2>/dev/null
    echo "✅ Server stopped successfully!"
else
    echo "ℹ️  No server running on port 5001"
fi

# Also kill any python processes running app.py (just in case)
pkill -f "python.*src/app.py" 2>/dev/null

echo "Done!"

#!/bin/bash
# code-flash Web — 开发模式启动（前后端热重载）
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${1:-8765}"

echo "╔══════════════════════════════════════════╗"
echo "║    code-flash Web · Dev Mode             ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Install backend deps
pip install -q -r "$SCRIPT_DIR/backend/requirements.txt" 2>/dev/null || \
pip3 install -q -r "$SCRIPT_DIR/backend/requirements.txt" 2>/dev/null

# Install frontend deps
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    npm install
fi

# Start backend in background
echo "🚀 Starting backend on port $BACKEND_PORT..."
cd "$SCRIPT_DIR/backend"
python3 -m uvicorn main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload &
BACKEND_PID=$!

# Start frontend dev server
echo "🎨 Starting frontend dev server..."
cd "$SCRIPT_DIR/frontend"
npx vite --port 5173 &
FRONTEND_PID=$!

echo ""
echo "✅ Dev servers running:"
echo "   Frontend: http://localhost:5173"
echo "   Backend:  http://localhost:$BACKEND_PORT"
echo ""
echo "Press Ctrl+C to stop both servers"

# Cleanup on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM

wait

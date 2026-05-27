#!/bin/bash
# code-flash Web — 一键启动脚本
# Usage: ./start.sh [port]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${1:-8765}"
FRONTEND_PORT=5173

echo "╔══════════════════════════════════════════╗"
echo "║     code-flash Web  AI Coding Assistant  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found"
    exit 1
fi

# Check Node
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found"
    exit 1
fi

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found"
    exit 1
fi

# Install backend dependencies
echo "📦 Installing backend dependencies..."
pip install -q -r "$SCRIPT_DIR/backend/requirements.txt" 2>/dev/null || \
pip3 install -q -r "$SCRIPT_DIR/backend/requirements.txt" 2>/dev/null

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
    npm install --silent
fi

# Build frontend
echo "🔨 Building frontend..."
npm run build --silent

# Start backend
echo ""
echo "🚀 Starting backend on port $BACKEND_PORT..."
echo "   Open http://localhost:$BACKEND_PORT in your browser"
echo ""

cd "$SCRIPT_DIR/backend"
python3 -m uvicorn main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload

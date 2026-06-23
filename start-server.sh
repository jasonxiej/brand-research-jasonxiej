#!/usr/bin/env bash
# ============================================================
#   Kiwii Brand Research Hub - Startup Script (macOS / Linux)
# ============================================================

set -e

PORT="${PORT:-8000}"

# Switch to script directory
cd "$(dirname "$0")"

echo
echo "============================================================"
echo "  Kiwii Brand Research Hub - Node backend starting"
echo "============================================================"
echo

# 1) Try to free port 8000
if command -v lsof >/dev/null 2>&1; then
  PID=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$PID" ]; then
    echo "[!] Port $PORT is busy, killing old process (PID=$PID)..."
    kill -9 $PID 2>/dev/null || true
    sleep 1
  fi
fi

# 2) Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "[X] Node.js not found. Please install Node 18+ from https://nodejs.org/"
  exit 1
fi

# 3) First-run: install dependencies
if [ ! -d "node_modules" ]; then
  echo "[+] First run, installing dependencies..."
  npm install
fi

# 4) Check .env
if [ ! -f ".env" ]; then
  echo
  echo "[Reminder] .env not found."
  echo "            cp .env.example .env  and fill in your API key (MINIMAX_API_KEY)."
  echo
fi

# 5) Detect LAN IP
LOCAL_IP=$(ipconfig 2>/dev/null | grep -oE 'inet (addr:)?([0-9]+\.){3}[0-9]+' | awk '{print $NF}' | head -n1)
if [ -z "$LOCAL_IP" ]; then
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
if [ -z "$LOCAL_IP" ]; then
  LOCAL_IP="127.0.0.1"
fi

if [ -n "$LAN_HOST" ]; then
  LOCAL_IP="$LAN_HOST"
fi

echo
echo "============================================================"
echo "  Service started:"
echo
echo "    Local    : http://localhost:$PORT/"
echo "    LAN      : http://$LOCAL_IP:$PORT/"
echo
echo "  Press Ctrl+C to stop."
echo "============================================================"
echo

# 6) Open browser (best-effort, OS-specific)
if command -v open >/dev/null 2>&1; then
  open "http://$LOCAL_IP:$PORT/" &
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://$LOCAL_IP:$PORT/" &
fi

# 7) Start backend
HOST="${HOST:-0.0.0.0}" exec node server.mjs
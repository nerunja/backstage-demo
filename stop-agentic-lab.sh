#!/usr/bin/env bash
# Stop the full Agentic Lab stack by freeing each of its ports.
# Usage: ./stop-agentic-lab.sh
set -e

PORTS=(3000 7007 4000 8000 9001 9002)
NAMES=("Backstage frontend" "Backstage backend" "CopilotKit runtime" "ADK orchestrator" "Research agent" "Analysis agent")

for i in "${!PORTS[@]}"; do
  port="${PORTS[$i]}"
  name="${NAMES[$i]}"
  pid=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "Stopping $name on :$port (pid $pid)"
    kill "$pid" 2>/dev/null || true
  fi
done

sleep 2

echo ""
echo "Remaining:"
for i in "${!PORTS[@]}"; do
  port="${PORTS[$i]}"
  name="${NAMES[$i]}"
  pid=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "  :$port ($name) still held by pid $pid — force with: kill -9 $pid"
  else
    echo "  :$port ($name) free"
  fi
done

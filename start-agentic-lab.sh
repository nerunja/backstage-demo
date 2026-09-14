#!/usr/bin/env bash
# Start the full Agentic Lab stack (4 services) in one command.
# Usage: ./start-agentic-lab.sh
set -e
cd "$(dirname "$0")"

if [ ! -f agents/.env ]; then
  echo "⚠️  agents/.env not found. Copy agents/.env.example to agents/.env and set OPENROUTER_API_KEY."
  exit 1
fi

# Ensure uv is available
if ! command -v uv >/dev/null 2>&1; then
  echo "⚠️  uv not found. Install it: curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi

# Sync Python deps once (fast no-op when up to date)
(cd agents && uv sync)

trap 'kill 0' EXIT

# 1. ADK orchestrator
(cd agents && uv run python orchestrator.py) &
# 2. A2A research agent
(cd agents && uv run python research_agent.py) &
# 3. A2A analysis agent
(cd agents && uv run python analysis_agent.py) &
# 4. CopilotKit runtime
(cd runtime && npm start) &
# 5. Backstage
yarn dev &

echo ""
echo "🚀 Agentic Lab stack starting:"
echo "   Backstage:        http://localhost:3000/agentic-lab"
echo "   Orchestrator:     http://localhost:8000/healthz"
echo "   Research agent:  http://localhost:9001/.well-known/agent.json"
echo "   Analysis agent:   http://localhost:9002/.well-known/agent.json"
echo "   CopilotKit:       http://localhost:4000/healthz"
echo ""
wait

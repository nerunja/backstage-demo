# Agentic Lab — Backstage × CopilotKit × AG-UI × A2UI × A2A × ADK

A learning/demo project: a [Backstage](https://backstage.io) app with a custom
frontend plugin (**Agentic Lab**) that demonstrates the modern agentic-UX
stack:

| Tech | Role |
| --- | --- |
| **Backstage** (new frontend system) | Host app + plugin page + software catalog |
| **CopilotKit** (React v2) | Chat UI, frontend tools, provider/runtime bridge |
| **AG-UI** | Event protocol between the frontend and the agent backend |
| **Google ADK** | Agent framework for the orchestrator + sub-agents (Python) |
| **A2A** | Agent-to-agent protocol — orchestrator delegates to research/analysis agents |
| **A2UI** | Generative UI spec — agent composes declarative UI JSON, client renders it |
| **GLM via OpenRouter** | LLM for all agents (ADK → LiteLLM → OpenRouter) |

## Architecture

```
Backstage (:3000)  plugins/agentic-lab  — 3 demo tabs
   │  CopilotKit React (AG-UI client)
   ▼
CopilotKit Runtime (:4000)  runtime/server.mjs
   │  A2A middleware (injects send_message_to_a2a_agent)
   ▼
ADK Orchestrator (:8000)    agents/orchestrator.py   (AG-UI + AGUIToolset)
   ├── A2A Research Agent (:9001)   agents/research_agent.py
   └── A2A Analysis Agent (:9002)   agents/analysis_agent.py
```

## The three demo tabs

1. **DevOps Assistant** — the agent calls a *frontend tool*
   (`list_catalog_entities`) that runs in the browser against the Backstage
   catalog API. Ask: *"What services are in the catalog?"*
2. **A2A Orchestrator** — the ADK orchestrator delegates over the A2A protocol
   to the Research and Analysis agents; the chat renders the agent-to-agent
   traffic as cards. Ask: *"Research quantum computing"*.
3. **A2UI Generative UI** — the agent composes UI from a registered component
   catalog (metric cards, forms, status lists). Ask: *"Show me a deployment
   status dashboard"* or *"Create a form to collect incident details"*.

## Prerequisites

- Node.js 22 or 24, yarn classic (1.22)
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- An [OpenRouter API key](https://openrouter.ai/keys)

## Setup

```bash
# 1. Backstage deps (from repo root)
yarn install

# 2. Python agents (uv manages the venv + deps)
cd agents
uv sync
cp .env.example .env       # then set OPENROUTER_API_KEY=...
cd ..

# 3. CopilotKit runtime
cd runtime
npm install
cd ..
```

## Run (correct startup order)

5 separate terminals. Order matters: the runtime's A2A middleware fetches
agent cards from the Research/Analysis agents at startup and crashes with
`ECONNREFUSED` if they aren't up yet.

```bash
# Terminal 1 — Research agent
cd agents
uv run python research_agent.py    # → :9001  (agent card at /.well-known/agent-card.json)

# Terminal 2 — Analysis agent
cd agents
uv run python analysis_agent.py    # → :9002

# Terminal 3 — Orchestrator (after 1 & 2 are up)
cd agents
uv run python orchestrator.py      # → :8000

# Terminal 4 — CopilotKit runtime (npm, NOT yarn — it's a separate project;
# after 1-3 are up)
cd runtime
npm start                          # → :4000  (AG-UI endpoint /copilotkit)

# Terminal 5 — Backstage (yarn, from the REPO ROOT — runtime/ is not in its workspaces)
cd ~/ws/git/nerunja/backstage-demo
yarn dev                           # → http://localhost:3000
```

Or start everything at once: `./start-agentic-lab.sh` (runs `uv sync` first).

Then open **http://localhost:3000/agentic-lab**.

If a tab's chat looks unresponsive (input does nothing, or A2UI never
renders), it's almost always one of these 5 not actually running — check
each with the commands in **Verify** below before assuming something is
broken.

### `EADDRINUSE` on `:3000` / `:7007` when running `yarn dev`

This means a *previous* `yarn dev` is already running and healthy — Ctrl-C
doesn't always kill it instantly (`backstage-cli repo start` spawns the
frontend and backend as separate child processes that can take a few
seconds to tear down), so an immediate retry can race the old instance
still shutting down, or you may have simply left an old terminal running.
Check before assuming it crashed:

```bash
lsof -ti:3000 -sTCP:LISTEN   # empty = safe to start; a PID = already running
curl -s localhost:3000       # 200 = it's already up, just open the browser
```

If it's already up and healthy, you don't need to start it again. To force
a clean restart: `lsof -ti:3000 | xargs kill -9` (same for `:7007`), then
`yarn dev`.

## Python agents (uv)

The `agents/` directory is a uv project (`pyproject.toml`):

- `uv sync` — create/update `.venv` and install all deps
- `uv run python <agent>.py` — run any agent (no manual activation needed)
- `uv add <package>` — add a new dependency (updates `pyproject.toml` + `uv.lock`)

## Verify

Check every service is actually up before testing a tab — an unresponsive
chat input or a UI that never renders almost always means one of these 5
was never started, not a code bug:

- `curl localhost:9001/.well-known/agent-card.json` → Research agent card
- `curl localhost:9002/.well-known/agent-card.json` → Analysis agent card
- `curl localhost:8000/healthz` → orchestrator health + model
- `curl localhost:4000/healthz` → runtime wiring info (orchestrator + A2A agent URLs)
- `curl -o /dev/null -w '%{http_code}\n' localhost:3000` → `200` = Backstage frontend is up

Then, in the browser:

- Tab 1 (DevOps Assistant): ask about the catalog → agent uses the frontend tool
- Tab 2 (A2A Orchestrator): "research quantum computing" → MessageToA2A/MessageFromA2A cards appear
- Tab 3 (A2UI Generative UI): ask for a dashboard/form → A2UI components render in chat

## Project layout

```
packages/app/                 Backstage app (plugin registered in App.tsx)
plugins/agentic-lab/          The frontend plugin (new frontend system)
  src/plugin.ts               createFrontendPlugin + PageBlueprint
  src/components/              Page + 3 tab components + a2ui catalog
agents/                       Python (uv project): orchestrator + 2 A2A agents
runtime/                      Node: CopilotKit runtime + A2A middleware
```

## Notes & gotchas

- **Startup order matters**: the CopilotKit runtime's A2A middleware fetches
  the A2A agent cards (`.well-known/agent-card.json`) eagerly at startup and will
  crash with `ECONNREFUSED` if the Python agents aren't up yet. Always:
  Python agents → runtime → Backstage (or just `./start-agentic-lab.sh`,
  which starts them in that order).
- **`runtime/` is a standalone npm project** (not in the root yarn
  workspaces, which only cover `packages/*` and `plugins/*`). Use `npm`
  inside it, and run `yarn dev` from the repo **root** only.
- **Model**: all agents use `openrouter/deepseek/deepseek-v4-pro` via ADK's
  LiteLLM integration (override with `AGENT_MODEL`). This must be a model
  that supports forced tool-calling (`tool_choice=required`) — the A2UI
  tab's `generate_a2ui` flow (in `ag_ui_adk`) always forces it for its
  internal subagent call. GLM-4.5 (and other models that only support
  `tool_choice=auto`) will fail with `litellm.BadRequestError: Tool choice
  must be auto` as soon as you try the A2UI tab, even though the other two
  tabs work fine with it.
  `gpt-4o-mini` also supports forced tool-calling, but for A2UI components
  with nested structure (e.g. `info-form`'s `fields` array) it can
  repeatedly emit malformed free-form JSON and exhaust the recovery loop's
  retry budget (`Failed to parse JSON: Extra data...` in the orchestrator
  log, ending in "Couldn't generate the UI" in the chat) — `deepseek-v4-pro`
  is far more reliable for this, at the cost of a slower response
  (~30-45s per A2UI generation vs a few seconds for simpler replies).
  The recovery loop's retry budget is bumped to 5 (from the default 3) via
  `a2ui={"recovery": {"maxAttempts": 5}}` in `orchestrator.py`'s
  `ADKAgent(...)` call, for extra headroom regardless of model.
- **CORS**: the runtime uses the official `createCopilotExpressHandler`
  adapter (`@copilotkit/runtime/v2/express`, single-route mode) with CORS
  allowing `:3000`, `:4173`, `:5010` (Backstage dev + plugin dev harness).
- **A2UI**: the catalog is attached per-tab (`A2UITab` mounts its own
  `CopilotKit` provider with `a2ui={{ catalog }}`), which auto-injects the
  `generate_a2ui` tool.
- The plugin can also run in isolation: `cd plugins/agentic-lab && yarn start`.
- **A2A tab renderer hook**: `A2AOrchestratorTab` must register its card
  renderer for `send_message_to_a2a_agent` with `useRenderTool`, never
  `useFrontendTool`. That tool is already injected server-side by the A2A
  middleware — `useFrontendTool` *declares a new tool* and forwards it to
  the backend, so using it here creates a second, colliding declaration
  with the same name. ADK logs `Duplicate tool name ... shadowed` and the
  run stalls forever (the middleware can't find the tool-call arguments it
  needs to relay the call). `useRenderTool` attaches a renderer to an
  *existing* tool without re-declaring it.
- **A2A agent session bug**: `research_agent.py` and `analysis_agent.py`
  each construct their `Runner` with an explicit `app_name` (e.g.
  `"research_agent"`), but originally created/fetched ADK sessions under
  `self._agent.name` (e.g. `"ResearchAgent"`) — a different string. The
  `Runner` looks sessions up by its own `app_name` internally, so it could
  never find a session created under the mismatched name, raising `Session
  not found: <uuid>` on every delegated call. Both files now use
  `self._runner.app_name` for session lookup/creation instead.

"""
Orchestrator Agent (ADK + AG-UI Protocol)

The main agent for the Agentic Lab. It receives user requests via the AG-UI
protocol (through the CopilotKit runtime) and can:

  1. Act as a DevOps/Backstage assistant (uses frontend tools registered by
     the Backstage plugin, e.g. catalog lookups).
  2. Delegate research/analysis tasks to specialized A2A agents — the
     CopilotKit A2A middleware injects the `send_message_to_a2a_agent` tool.
  3. Generate A2UI declarative UI payloads (the ag-ui-adk adapter injects the
     `generate_a2ui` tool when the frontend registers an A2UI catalog).

Run:  uvicorn orchestrator:app --port 8000   (or python orchestrator.py)
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from ag_ui_adk import ADKAgent, AGUIToolset, add_adk_fastapi_endpoint
from google.adk.agents import LlmAgent

from shared import MODEL

INSTRUCTION = """
You are the Agentic Lab assistant inside a Backstage developer portal.

You have three modes of operation, and you pick based on the user's request:

1. DEVOPS ASSISTANT (default):
   You help developers with their platform. The frontend may register tools
   such as `list_catalog_entities` — call them to answer questions about the
   software catalog (services, APIs, resources). When no tool is available,
   answer from general Backstage/DevOps knowledge.

2. A2A ORCHESTRATION:
   When the user asks to research or analyze a topic, you may have a
   `send_message_to_a2a_agent` tool. Call agents ONE AT A TIME:
   first the Research Agent to gather findings, then the Analysis Agent to
   derive insights. Pass earlier results into later calls. Synthesize a
   final answer — do not just paste agent responses.

3. A2UI GENERATIVE UI:
   When the user asks for a form, dashboard, card, or any visual layout, and
   you have a `generate_a2ui` tool, call it to compose UI from the registered
   component catalog. After it returns, stop — the rendered UI is the answer.

General rules:
- Be concise and developer-friendly.
- Never fabricate tool results.
- If a needed tool is missing, say so briefly and answer best-effort.
"""

orchestrator_agent = LlmAgent(
    name="AgenticLabOrchestrator",
    model=MODEL,
    instruction=INSTRUCTION,
    # AGUIToolset exposes CopilotKit frontend tools (useFrontendTool,
    # useAgentContext, HITL) to the model.
    tools=[AGUIToolset()],
)

# Wrap with AG-UI middleware to expose via the AG-UI protocol
adk_orchestrator_agent = ADKAgent(
    adk_agent=orchestrator_agent,
    app_name="agentic_lab",
    user_id="demo_user",
    session_timeout_seconds=3600,
    use_in_memory_services=True,
    a2ui={
        # gpt-4o-mini occasionally emits malformed free-form JSON for the
        # more complex catalog components (e.g. info-form's nested fields
        # array) — the default 3 attempts isn't always enough for the
        # validate-error feedback loop to converge, so give it more room.
        "recovery": {"maxAttempts": 5},
    },
)

app = FastAPI(title="Agentic Lab Orchestrator (ADK + AG-UI)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:4173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

add_adk_fastapi_endpoint(app, adk_orchestrator_agent, path="/")


@app.get("/healthz")
def healthz():
    return {"status": "ok", "model": MODEL}


if __name__ == "__main__":
    if not os.getenv("OPENROUTER_API_KEY"):
        print("⚠️  Warning: OPENROUTER_API_KEY not set!")
        print("   Get a key from: https://openrouter.ai/keys")
        print()
    port = int(os.getenv("ORCHESTRATOR_PORT", 8000))
    print(f"🧠 Starting Agentic Lab Orchestrator on http://localhost:{port}")
    uvicorn.run("orchestrator:app", host="0.0.0.0", port=port, reload=False)

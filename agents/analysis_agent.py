"""
Analysis Agent (ADK + A2A Protocol)

Analyzes research findings and produces insights. Exposes an A2A Protocol
endpoint on port 9002 so the orchestrator (via CopilotKit's A2A middleware)
can delegate analysis tasks to it.

Run:  python analysis_agent.py
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

import uvicorn
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.utils import new_agent_text_message

# Google ADK imports
from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from shared import MODEL

port = int(os.getenv("ANALYSIS_PORT", 9002))

skill = AgentSkill(
    id="analysis_agent",
    name="Analysis Agent",
    description="Analyzes research findings and provides meaningful insights using ADK",
    tags=["research", "analysis", "insights", "adk"],
    examples=[
        "Analyze this research about quantum computing",
        "What are the key insights from this data?",
        "Provide analysis of these research findings",
    ],
)

public_agent_card = AgentCard(
    name="Analysis Agent",
    description="ADK-powered agent that analyzes research findings and provides meaningful insights",
    url=f"http://localhost:{port}/",
    version="1.0.0",
    defaultInputModes=["text"],
    defaultOutputModes=["text"],
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill],
    supportsAuthenticatedExtendedCard=False,
)


class AnalysisAgent:
    """Thin wrapper around an ADK LlmAgent run through a Runner."""

    def __init__(self):
        self._agent = LlmAgent(
            name="AnalysisAgent",
            model=MODEL,
            instruction=(
                "You are an analysis agent. You receive research findings or "
                "raw information from another agent. Identify key themes, "
                "strengths, risks, and actionable insights. Be structured and "
                "concise. Do not ask questions — always produce your best "
                "analysis of the material provided."
            ),
        )
        self._runner = Runner(
            agent=self._agent,
            session_service=InMemorySessionService(),
            app_name="analysis_agent",
        )
        self._user_id = "a2a_user"

    async def invoke(self, query: str, session_id: str) -> str:
        # Must match the Runner's own app_name ("analysis_agent") — the
        # Runner looks sessions up by its configured app_name internally, so
        # creating/fetching them under a different one (e.g. self._agent.name,
        # "AnalysisAgent") makes run_async() unable to find a session this
        # method just created, raising "Session not found".
        session = await self._runner.session_service.get_session(
            app_name=self._runner.app_name,
            user_id=self._user_id,
            session_id=session_id,
        )
        if session is None:
            session = await self._runner.session_service.create_session(
                app_name=self._runner.app_name,
                user_id=self._user_id,
                state={},
                session_id=session_id,
            )

        content = types.Content(role="user", parts=[types.Part.from_text(text=query)])

        response_text = ""
        async for event in self._runner.run_async(
            user_id=self._user_id, session_id=session.id, new_message=content
        ):
            if event.is_final_response():
                if (
                    event.content
                    and event.content.parts
                    and event.content.parts[0].text
                ):
                    response_text = "\n".join(
                        p.text for p in event.content.parts if p.text
                    )
        return response_text


class AnalysisAgentExecutor(AgentExecutor):
    def __init__(self):
        self.agent = AnalysisAgent()

    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        query = context.get_user_input()
        session_id = getattr(context, "context_id", "default_session")
        result = await self.agent.invoke(query, session_id)
        await event_queue.enqueue_event(new_agent_text_message(result))

    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        raise Exception("cancel not supported")


def main():
    if not os.getenv("OPENROUTER_API_KEY"):
        print("⚠️  Warning: OPENROUTER_API_KEY not set!")
        print("   Get a key from: https://openrouter.ai/keys")
        print()

    request_handler = DefaultRequestHandler(
        agent_executor=AnalysisAgentExecutor(),
        task_store=InMemoryTaskStore(),
    )

    server = A2AStarletteApplication(
        agent_card=public_agent_card,
        http_handler=request_handler,
        extended_agent_card=public_agent_card,
    )

    print(f"💡 Starting Analysis Agent (ADK + A2A) on http://localhost:{port}")
    print(f"   Agent card: http://localhost:{port}/.well-known/agent.json")
    uvicorn.run(server.build(), host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()

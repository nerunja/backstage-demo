/**
 * Agentic Lab — CopilotKit Runtime (standalone Node service, port 4000)
 *
 * Bridges the Backstage frontend (CopilotKit React) to the agent backend:
 *
 *   - `agentic-lab` agent → ADK orchestrator (Python :8000) over AG-UI,
 *     wrapped in the A2A middleware so it can delegate to the A2A
 *     research (:9001) and analysis (:9002) agents.
 *
 * The A2A middleware injects the `send_message_to_a2a_agent` tool into the
 * orchestrator and streams agent-to-agent traffic back to the frontend.
 */
import express from 'express';
import { concatMap, of, tap, timer, map as rxMap } from 'rxjs';
import { HttpAgent } from '@ag-ui/client';
import { A2AMiddlewareAgent } from '@ag-ui/a2a-middleware';
import {
  CopilotRuntime,
  InMemoryAgentRunner,
} from '@copilotkit/runtime/v2';
import { createCopilotExpressHandler } from '@copilotkit/runtime/v2/express';

// --- Patch: @ag-ui/a2a-middleware@0.0.2 doesn't override AbstractAgent#clone().
// CopilotRuntime clones the agent for every run (so each chat run gets
// isolated state), but the base AbstractAgent#clone() only copies the base
// class's own fields (threadId, messages, state, ...) — it has no idea about
// A2AMiddlewareAgent's own fields (agentClients, agentCards, instructions,
// orchestrationAgent). Without this patch every clone silently drops them,
// so `this.agentCards` is undefined on the very first real chat message and
// the whole process crashes trying to `.map()` over it.
const originalClone = A2AMiddlewareAgent.prototype.clone;
A2AMiddlewareAgent.prototype.clone = function patchedClone() {
  const cloned = originalClone.call(this);
  cloned.instructions = this.instructions;
  cloned.agentClients = this.agentClients;
  cloned.agentCards = this.agentCards;
  // Clone the orchestration agent too, so each run gets its own isolated
  // message/state history instead of sharing one across every tab/thread.
  cloned.orchestrationAgent = this.orchestrationAgent.clone();
  return cloned;
};

const PORT = process.env.RUNTIME_PORT || 4000;

const orchestratorUrl =
  process.env.ORCHESTRATOR_URL || 'http://localhost:8000';
const researchAgentUrl =
  process.env.RESEARCH_AGENT_URL || 'http://localhost:9001';
const analysisAgentUrl =
  process.env.ANALYSIS_AGENT_URL || 'http://localhost:9002';

// The orchestrator is an AG-UI agent reachable over HTTP.
const orchestrationAgent = new HttpAgent({ url: orchestratorUrl });

// --- Patch: @ag-ui/a2a-middleware@0.0.2 races RUN_FINISHED against its own
// async message-state update.
//
// The middleware's wrapStream() applies each event to `this.messages` via
// `this.apply(...)` + a fire-and-forget `processApplyEvents(...).subscribe()`
// (not awaited). When RUN_FINISHED arrives, it synchronously reads
// `this.messages` to find the just-completed tool call's arguments — but if
// TOOL_CALL_END and RUN_FINISHED arrive back-to-back with no gap, that async
// update may not have landed yet, and it throws "Tool arguments not found
// for tool call id ...", killing the run with no error surfaced to the
// browser (it just stalls forever).
//
// This bites models that stream a tool call's entire JSON as a single
// TOOL_CALL_ARGS delta (observed with DeepSeek V4 Pro) — there's no
// token-by-token gap for the async update to win the race in. Models that
// stream token-by-token (e.g. gpt-4o-mini) happen to leave enough real time
// between events for it to resolve correctly, which is why this doesn't
// reproduce with every model.
//
// Fix: delay RUN_FINISHED by a small fixed amount (not every event, so
// normal token streaming isn't slowed down) — enough for the async apply
// pipeline's pending work to flush first. Patched on the prototype (not the
// instance) since `.clone()` creates new instances via the prototype's own
// methods.
const RUN_FINISHED_DELAY_MS = 50;
const originalHttpRun = HttpAgent.prototype.run;
HttpAgent.prototype.run = function (...args) {
  return originalHttpRun.apply(this, args).pipe(
    concatMap(e =>
      e.type === 'RUN_FINISHED'
        ? timer(RUN_FINISHED_DELAY_MS).pipe(rxMap(() => e))
        : of(e),
    ),
  );
};

// TEMP DIAGNOSTIC: set DEBUG_AGUI_EVENTS=1 to log every raw AG-UI event from
// the orchestrator, before the A2A middleware processes them.
if (process.env.DEBUG_AGUI_EVENTS) {
  const patchedHttpRun = HttpAgent.prototype.run;
  HttpAgent.prototype.run = function (...args) {
    return patchedHttpRun.apply(this, args).pipe(
      tap(e => {
        const { type, toolCallId, toolCallName, delta, messageId, role } = e;
        console.log(
          '[AGUI EVENT]',
          type,
          JSON.stringify({ toolCallId, toolCallName, messageId, role, delta }),
        );
      }),
    );
  };
}

// A2A middleware: wraps the orchestrator and injects the
// `send_message_to_a2a_agent` tool so it can talk to the A2A agents.
// Each run needs an isolated middleware agent (per-run state), so build
// fresh instances rather than sharing one across requests.
function createAgenticLabAgent() {
  return new A2AMiddlewareAgent({
    description:
      'Agentic Lab assistant: a Backstage DevOps assistant that can also ' +
      'orchestrate research and analysis across specialized A2A agents, and ' +
      'compose generative UI (A2UI).',
    agentUrls: [researchAgentUrl, analysisAgentUrl],
    orchestrationAgent,
    instructions: `
      You are the Agentic Lab assistant inside a Backstage developer portal.

      AVAILABLE AGENTS (via send_message_to_a2a_agent):
      - Research Agent (ADK): Gathers and summarizes information about a topic
      - Analysis Agent (ADK): Analyzes research findings and provides insights

      WORKFLOW STRATEGY (SEQUENTIAL - ONE AT A TIME):
      When the user asks to research a topic:
      1. Research Agent - First, gather information about the topic
      2. Analysis Agent - Then, analyze the research results
      3. Present the complete research and analysis to the user

      CRITICAL RULES:
      - Call agents ONE AT A TIME, wait for results before making next call
      - Pass information from earlier agents to later agents
      - Synthesize all gathered information in final response
      - For Backstage/DevOps questions, answer directly (no delegation needed)
    `,
  });
}

const runtime = new CopilotRuntime({
  agents: {
    'agentic-lab': createAgenticLabAgent(),
    // Alias for any internal default-agent lookup.
    default: createAgenticLabAgent(),
  },
  runner: new InMemoryAgentRunner(),
});

// Guard against a single bad request crashing the whole dev server. The A2A
// middleware is an early-stage (0.0.x) package and can throw synchronously
// from inside an RxJS pipeline (e.g. racing two runs on the same thread, or
// losing track of a tool call) in a way Express's request handler can't
// catch. Without this, one malformed/overlapping request kills every tab.
process.on('uncaughtException', err => {
  console.error('Uncaught exception (runtime kept alive):', err);
});
process.on('unhandledRejection', err => {
  console.error('Unhandled rejection (runtime kept alive):', err);
});

const app = express();

// Official CopilotKit Express adapter — mounts all AG-UI runtime routes
// (POST /copilotkit, runtime-info detection, etc.) with CORS built in.
app.use(
  createCopilotExpressHandler({
    runtime,
    basePath: '/copilotkit',
    mode: 'single-route',
    cors: {
      origin: [
        'http://localhost:3000',
        'http://localhost:4173',
        'http://localhost:5010',
      ],
      credentials: true,
    },
  }),
);

app.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    orchestrator: orchestratorUrl,
    a2aAgents: [researchAgentUrl, analysisAgentUrl],
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Agentic Lab CopilotKit runtime on http://localhost:${PORT}`);
  console.log(`   AG-UI endpoint: http://localhost:${PORT}/copilotkit`);
  console.log(`   Orchestrator:  ${orchestratorUrl}`);
  console.log(`   A2A agents:    ${researchAgentUrl}, ${analysisAgentUrl}`);
});

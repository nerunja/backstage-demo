# Learning Guide: Backstage Plugins, CopilotKit, AG-UI, A2UI, A2A, ADK

This document explains every technology in this repo — what it's for and
how it works, fundamentals through to depth — using this project's own
files as the running example. Read it top to bottom once, then keep it as
a reference; each section stands alone and points at exact files.

For setup and run instructions (starting all 5 services, prerequisites,
verification steps), see **[AGENTIC-LAB.md](AGENTIC-LAB.md)**.

---

## 0. The big picture

Five different pieces of software, from four different vendors, glued into
one request path:

```
┌─────────────────────────────────────────────────────────────┐
│ Backstage (:3000)                                            │
│   plugins/agentic-lab — a page extension, 3 chat tabs         │
│   Frontend: React + CopilotKit React SDK                      │
└───────────────────────────┬────────────────────────────────┘
                             │ HTTP, AG-UI protocol
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ CopilotKit Runtime (:4000)  runtime/server.mjs                │
│   Node/Express. Bridges the browser to the agent backend.     │
│   Wraps the orchestrator in A2A middleware (adds the           │
│   send_message_to_a2a_agent tool + relays agent-to-agent      │
│   traffic back to the browser as events).                     │
└───────────────────────────┬────────────────────────────────┘
                             │ HTTP, AG-UI protocol
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ ADK Orchestrator (:8000)  agents/orchestrator.py               │
│   Python. A Google ADK LlmAgent wrapped in ag_ui_adk's         │
│   ADKAgent (speaks AG-UI in, ADK semantics out).               │
│   Model: an LLM via LiteLLM → OpenRouter.                      │
└──────────┬──────────────────────────────────┬─────────────┘
           │ A2A protocol (JSON-RPC)            │ (same process,
           ▼                                    │  A2UI subagent call)
┌────────────────────────┐   ┌────────────────────────┐
│ Research Agent (:9001)  │   │ Analysis Agent (:9002)  │
│ agents/research_agent.py│   │ agents/analysis_agent.py│
│ A Python A2A *server*   │   │ A Python A2A *server*   │
└────────────────────────┘   └────────────────────────┘
```

One user message ("Research quantum computing") travels through *all six*
boxes and back. Each of the sections below is one box (or one protocol
connecting two boxes).

---

## 1. Backstage plugins (the "new frontend system")

### 1.1 Fundamentals

Backstage is a framework for building an internal developer portal: one
React app (the "app") that different teams extend with **plugins** —
self-contained npm packages that register pages, cards, API clients, etc.
without the app needing to know about them ahead of time.

Backstage has *two* plugin systems:

- **Old system** (`createPlugin`, classic exports): imperative
  registration, still what most tutorials online show.
- **New frontend system** (`createFrontendPlugin`, "Blueprints"): a
  declarative, composable model. This repo uses the new system —
  `plugins/agentic-lab/src/plugin.tsx` imports from
  `@backstage/frontend-plugin-api`, not the classic `@backstage/core-plugin-api`.

In the new system, everything the app can render is an **Extension** — a
typed unit with declared inputs/outputs. A **Blueprint** is a factory for a
common extension shape, so you don't hand-write the extension's guts every
time. `PageBlueprint` is the one for "a routable page."

### 1.2 How it's wired in this repo

**[plugins/agentic-lab/src/routes.ts](plugins/agentic-lab/src/routes.ts)**
```ts
export const rootRouteRef = createRouteRef();
```
A `RouteRef` is an opaque handle other plugins can use to link to this
page *without* hardcoding its URL path. In the new frontend system, a
route is identified by *where it's exported from*, not by a string you
choose — `createRouteRef()` takes no `id`.

**[plugins/agentic-lab/src/plugin.tsx](plugins/agentic-lab/src/plugin.tsx)**
```ts
const agenticLabPage = PageBlueprint.make({
  params: {
    routeRef: rootRouteRef,
    path: '/agentic-lab',
    title: 'Agentic Lab',
    icon: <MemoryIcon />,
    loader: () => import('./components/AgenticLabPage').then(m => <m.AgenticLabPage />),
  },
});

export const agenticLabPlugin = createFrontendPlugin({
  pluginId: 'agentic-lab',
  extensions: [agenticLabPage],
  routes: { root: rootRouteRef },
});
```
- `loader` is lazy — the page component's *code* (and everything it
  imports, including CopilotKit) is only downloaded when a user actually
  navigates to `/agentic-lab`. A plugin can pull in a heavy dependency
  tree without slowing down every other Backstage page.
- `createFrontendPlugin` bundles one or more extensions into an
  installable unit and declares which `RouteRef`s it owns (`routes: {root:
  rootRouteRef}`) so other plugins could link to it by name.

**[plugins/agentic-lab/src/index.ts](plugins/agentic-lab/src/index.ts)**
```ts
export { agenticLabPlugin as default } from './plugin';
export { rootRouteRef as agenticLabRouteRef } from './routes';
```
The plugin's public API surface — a default export (the plugin itself, for
`features: [...]`) plus a named export other plugins could import to link
to this page.

**[packages/app/src/App.tsx](packages/app/src/App.tsx)**
```ts
export default createApp({
  features: [catalogPlugin, agenticLabPlugin, navModule, homeModule],
});
```
This is the entire "installation" step: add the plugin to `features`.
`createApp` (from `@backstage/frontend-defaults`) resolves every
extension's dependency graph, wires up routing, and produces the actual
React tree. There is no manual route registration, no sidebar-editing —
`PageBlueprint` extensions automatically get a sidebar nav entry from
their `title`/`icon`.

### 1.3 The mental model to keep

Backstage's new frontend system separates **declaration** (what extensions
exist, what they need, what they provide — all typed and inspectable
without running any React) from **instantiation** (actually building the
component tree at runtime). This is why `createApp` can do things like
detect extension conflicts or let you override a plugin's page component
from `app-config.yaml` without touching plugin code — the declaration is
data, not just a side-effecting function call.

---

## 2. CopilotKit

### 2.1 Fundamentals

CopilotKit is two things that are easy to conflate:

1. **`@copilotkit/react-core`** — the React SDK. Gives you `<CopilotKit>`
   (a provider), `<CopilotChat>` (a chat UI), and hooks to register tools
   the *browser* can execute, or to render UI for tools the *agent
   backend* executes.
2. **`@copilotkit/runtime`** — a Node.js server SDK. Sits between the
   browser and your actual agent (LangGraph, CrewAI, ADK, a raw LLM call —
   anything). Speaks the AG-UI protocol on both sides, so the browser
   never talks to your agent framework directly.

You always need both: the React SDK renders the chat and forwards
messages to a `runtimeUrl`; the runtime SDK receives them and drives
whatever agent you've configured.

### 2.2 Client side — four hooks, four distinct roles

| Hook | What it does | Who executes the tool |
|---|---|---|
| `useFrontendTool` | **Declares a new tool.** Sends its schema to the backend as something the model can call. | The **browser** (via your `handler`) |
| `useRenderTool` | Attaches a **renderer** to a tool that **already exists** elsewhere in the system. Sends nothing new to the backend. | Whoever already owns that tool |
| `useComponent` | Declares a new **render-only** tool — the model's only reason to call it is to make something appear. | Nobody — pure UI |
| `useDefaultRenderTool` | A wildcard fallback renderer for any tool call without a dedicated one. | N/A |

The rule that decides which one to reach for: does the tool *already
exist* somewhere else (server-injected middleware, another agent), or is
the browser the thing that should actually execute it?

**[plugins/agentic-lab/src/components/DevopsAssistantTab.tsx](plugins/agentic-lab/src/components/DevopsAssistantTab.tsx)**
uses `useFrontendTool` — `list_catalog_entities` doesn't exist anywhere
else; the browser is the only thing that can call the Backstage Catalog
API, so it declares the tool and provides the `handler`:
```ts
useFrontendTool({
  name: 'list_catalog_entities',
  parameters: z.object({ filter: z.string().optional() }),
  handler: async ({ filter }) => {
    const items = await catalogApi.getEntities();
    // ...
    return JSON.stringify({ entities });
  },
});
```
Note the return shape: a frontend tool's result is relayed to the model as
a "function response," and ADK/Gemini's function-calling wire format
requires that response to be a JSON **object**, not a bare array — hence
`{ entities: [...] }` rather than the array on its own.

**[plugins/agentic-lab/src/components/A2AOrchestratorTab.tsx](plugins/agentic-lab/src/components/A2AOrchestratorTab.tsx)**
uses `useRenderTool` — `send_message_to_a2a_agent` is already declared
server-side by the A2A middleware (§5). This tab only draws a card when
that tool is called; it must not re-declare the tool itself:
```ts
useRenderTool({
  name: 'send_message_to_a2a_agent',
  parameters: z.object({ agentName: z.string(), task: z.string() }),
  render: (props) => (<>...</>),
});
```

### 2.3 Server side — `CopilotRuntime`

**[runtime/server.mjs](runtime/server.mjs)**
```js
const runtime = new CopilotRuntime({
  agents: {
    'agentic-lab': createAgenticLabAgent(),
    default: createAgenticLabAgent(),
  },
  runner: new InMemoryAgentRunner(),
});

app.use(createCopilotExpressHandler({
  runtime,
  basePath: '/copilotkit',
  mode: 'single-route',
  cors: { origin: [...], credentials: true },
}));
```
- `agents` is a name → `AbstractAgent` map. The frontend's
  `<CopilotKit agent="agentic-lab">` selects which one handles a given
  chat.
- `createCopilotExpressHandler` mounts every route CopilotKit needs
  (`POST /copilotkit`, `GET /copilotkit/info`, SSE streaming, etc.) under
  one Express router — you don't hand-write any of the wire protocol.
- `InMemoryAgentRunner` calls `.run()` on your agent per request, and
  **clones the agent for every run**: each turn gets isolated
  `threadId`/`messages`/state instead of one shared mutable object racing
  across concurrent users. A subclassed agent that adds its own fields
  (like the A2A middleware in §5.4) is responsible for making sure its
  clone override carries those fields across too, since the base
  `AbstractAgent.clone()` only knows about its own fields.

---

## 3. AG-UI — the protocol connecting frontend ↔ agent

### 3.1 Fundamentals

AG-UI (Agent-User Interaction Protocol) is an **event stream**, not a
request/response API. A "run" is a sequence of typed events sent over SSE:

```
RUN_STARTED
TEXT_MESSAGE_START   (role: assistant)
TEXT_MESSAGE_CONTENT (delta: "I'll research...")
TEXT_MESSAGE_CONTENT (delta: " quantum computing.")
TEXT_MESSAGE_END
TOOL_CALL_START       (toolCallName: "send_message_to_a2a_agent")
TOOL_CALL_ARGS        (delta: '{"agentName":"Rese')
TOOL_CALL_ARGS        (delta: 'arch Agent","task":"...')
TOOL_CALL_END
TOOL_CALL_RESULT      (content: "...")
RUN_FINISHED
```
This is *why* a chat UI can stream tokens live, show "in progress" tool
cards, and correlate results back to the right call — every event carries
enough IDs (`messageId`, `toolCallId`, `threadId`, `runId`) to reassemble
the whole turn incrementally on the client.

`AbstractAgent` (in `@ag-ui/client`) is the base class any AG-UI-speaking
agent implements: it exposes `.run(input)` returning an `Observable` of
these events, plus `.messages`/`.state` as the running snapshot, plus
`.clone()` for the per-run isolation described above. `HttpAgent` is the
"dumb" implementation used in this repo for the orchestrator connection —
it just POSTs to a URL and turns the SSE response back into the same
event stream:
```js
const orchestrationAgent = new HttpAgent({ url: 'http://localhost:8000' });
```

### 3.2 Why it exists

Before AG-UI (and its cousins like Vercel's AI SDK protocol), every agent
framework invented its own wire format, so every frontend needed a custom
adapter per backend. AG-UI standardizes the *transport* so a chat UI (like
CopilotKit's) can drive ADK, LangGraph, CrewAI, or a hand-rolled agent
interchangeably, as long as something on the server translates that
framework's native execution into these events. That translator, for ADK,
is `ag_ui_adk` (§4.3).

### 3.3 Where it shows up in this repo

- **Frontend → Runtime**: `<CopilotKit runtimeUrl="http://localhost:4000/copilotkit">`
  — the React SDK speaks AG-UI to the runtime's `/copilotkit` endpoint.
- **Runtime → Orchestrator**: `new HttpAgent({ url: 'http://localhost:8000' })`
  — the runtime speaks AG-UI *again*, this time to the Python orchestrator.
- Two independent AG-UI hops. The middleware in the middle (§5) reshapes
  what flows between them (injecting a tool, splicing in agent-to-agent
  traffic) but doesn't change the protocol itself.

---

## 4. Google ADK (Agent Development Kit)

### 4.1 Fundamentals

ADK is Google's Python framework for building LLM agents: define an
`LlmAgent` (a model + instruction + tools), run it through a `Runner`
against a `SessionService` that persists conversation state, and consume
the resulting `Event` stream (text deltas, tool calls, tool results).

Model-agnostic by design: `LlmAgent(model="gemini-2.0-flash", ...)` calls
Gemini directly, but `LlmAgent(model="openrouter/<vendor>/<model>", ...)`
routes through **LiteLLM**, ADK's adapter to ~100 other providers. This
repo's [agents/shared.py](agents/shared.py) sets that:
```python
MODEL = os.getenv("AGENT_MODEL", "openrouter/z-ai/glm-4.5")
```
Any `openrouter/<vendor>/<model>` string works as long as
`OPENROUTER_API_KEY` is set — LiteLLM reads it automatically.

### 4.2 Sessions

A `SessionService` stores conversation state keyed by a composite
**`(app_name, user_id, session_id)`**, all three of which must match for a
lookup to succeed. `Runner` is constructed with its own `app_name`, and
uses that same value internally whenever it looks up a session during
`run_async()` — so any code that manually creates or fetches a session
must key it with the exact same `app_name` the `Runner` was built with:

**[agents/research_agent.py](agents/research_agent.py)**
```python
self._runner = Runner(agent=self._agent, session_service=..., app_name="research_agent")

async def invoke(self, query, session_id):
    session = await self._runner.session_service.get_session(
        app_name=self._runner.app_name,   # always the Runner's own app_name
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
    async for event in self._runner.run_async(
        user_id=self._user_id, session_id=session.id, new_message=content
    ):
        ...
```
Deriving the app name from `self._runner.app_name` (rather than repeating
a literal, or using an unrelated identifier like the agent's `.name`)
keeps session creation and session lookup permanently in sync, since
there's only one source of truth.

### 4.3 `ag_ui_adk` — the ADK ↔ AG-UI bridge

**[agents/orchestrator.py](agents/orchestrator.py)**:
```python
orchestrator_agent = LlmAgent(
    name="AgenticLabOrchestrator",
    model=MODEL,
    instruction=INSTRUCTION,
    tools=[AGUIToolset()],   # exposes browser-declared frontend tools to the model
)

adk_orchestrator_agent = ADKAgent(
    adk_agent=orchestrator_agent,
    app_name="agentic_lab",
    user_id="demo_user",
    use_in_memory_services=True,
    a2ui={"recovery": {"maxAttempts": 5}},
)

add_adk_fastapi_endpoint(app, adk_orchestrator_agent, path="/")
```
`ADKAgent` is the translator: it exposes a FastAPI endpoint that speaks
AG-UI on the wire, and internally drives ADK's `Runner`/`LlmAgent` to
produce the response, converting between the two event models. Two things
worth understanding:

- **`AGUIToolset`** is a *placeholder* at construction time. Per-run,
  `ADKAgent` substitutes it for a `ClientProxyToolset` built fresh from
  that request's `input.tools` (whatever the browser/middleware
  forwarded). This is what lets the DevOps tab's `list_catalog_entities`
  (declared per-tab in React) show up as a real ADK tool without the
  orchestrator ever hardcoding it.
- **`a2ui={...}`** opts the orchestrator into A2UI generation (§6). ADK
  sessions are internally keyed by `(thread_id, user_id)`, so different
  browser tabs/threads get isolated conversation state even though
  `user_id` is a single fixed `"demo_user"` for every request in this
  demo.

---

## 5. A2A (Agent2Agent protocol)

### 5.1 Fundamentals

A2A is a protocol for **agent-to-agent** delegation — one agent (an
"orchestrator" or "client") calls another, independently-hosted agent (a
"remote agent" or "server") as a black box, over plain HTTP/JSON-RPC. The
server doesn't need to be built with the same framework, language, or
even vendor as the client — it just needs to expose:

1. An **Agent Card** at `/.well-known/agent.json` — a JSON document
   describing what the agent does, its skills, and its endpoint URL.
2. A JSON-RPC (or REST) endpoint implementing `message/send`,
   `tasks/get`, etc., per the A2A spec.

This is the same shape as OpenAPI/gRPC service discovery, but tailored to
agentic work: an "Agent Card" is like an OpenAPI spec, but describes
*capabilities* ("gathers and summarizes information") rather than
*endpoints*.

### 5.2 The two SDKs in this repo

There are **two independent A2A SDKs** here, one per language:

| | Package | Used by |
|---|---|---|
| Python (server) | `a2a-sdk` | `research_agent.py`, `analysis_agent.py` |
| JS (client) | `@a2a-js/sdk` | `runtime/server.mjs` (via `@ag-ui/a2a-middleware`) |

This repo's Python agents target the pre-1.0, pydantic-based `a2a-sdk`
API (`A2AStarletteApplication`, a pydantic `AgentCard`), pinned via
`pyproject.toml` as `a2a-sdk>=0.3.0,<0.4.0`. `a2a-sdk`'s `1.x` line is an
unrelated, incompatible protobuf-based rewrite (different module layout,
`snake_case` fields) — worth knowing since both live on PyPI under the
same package name.

### 5.3 The A2A servers — `research_agent.py` / `analysis_agent.py`

```python
skill = AgentSkill(id="research_agent", name="Research Agent", ...)
public_agent_card = AgentCard(
    name="Research Agent", url=f"http://localhost:{port}/",
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill], ...
)

class ResearchAgentExecutor(AgentExecutor):
    async def execute(self, context: RequestContext, event_queue: EventQueue):
        query = context.get_user_input()
        session_id = getattr(context, "context_id", "default_session")
        result = await self.agent.invoke(query, session_id)
        await event_queue.enqueue_event(new_agent_text_message(result))

server = A2AStarletteApplication(agent_card=public_agent_card, http_handler=request_handler)
uvicorn.run(server.build(), ...)
```
Each of these is a **complete, independent web server** — you could `curl`
it directly, or drive it from a totally different orchestrator, with zero
code changes. `AgentExecutor.execute()` is the one method you implement:
receive a `RequestContext` (the incoming task), do whatever work (here:
run an ADK `LlmAgent` internally — A2A doesn't care what's inside), and
push the result onto an `EventQueue`.

### 5.4 The A2A client — `@ag-ui/a2a-middleware`

**[runtime/server.mjs](runtime/server.mjs)**:
```js
function createAgenticLabAgent() {
  return new A2AMiddlewareAgent({
    agentUrls: [researchAgentUrl, analysisAgentUrl],
    orchestrationAgent,     // the HttpAgent pointed at :8000
    instructions: `...`,
  });
}
```
`A2AMiddlewareAgent` wraps the ADK orchestrator connection and, on
construction, fetches every remote agent's card
(`new A2AClient(url)` triggers this immediately) so it knows their names
and descriptions. On every `.run()`, it:

1. Builds a system prompt listing the available remote agents (from those
   cards) and injects a `send_message_to_a2a_agent` tool declaration into
   the request sent to the orchestrator.
2. Watches the event stream: when the model emits a
   `TOOL_CALL_START` whose name starts with `send_message_to_a2a_agent`,
   it intercepts that call — instead of letting the orchestrator "execute"
   it, the middleware itself opens an `A2AClient.sendMessage()` call to
   whichever remote agent the model named, waits for the reply, and
   injects a synthetic `TOOL_CALL_RESULT` back into the stream so the
   orchestrator (and the browser) see it as if it had happened locally.
3. Automatically triggers a **new run** with the tool result appended, so
   the orchestrator can synthesize a final answer.

This works because `send_message_to_a2a_agent` is declared exactly *once*
— by the middleware, server-side. The frontend only attaches a *renderer*
to that same name (§2.2), never a second declaration, which is what lets
the middleware reliably correlate every tool-call event back to the right
arguments as it streams past.

---

## 6. A2UI (generative UI)

### 6.1 Fundamentals

A2UI lets an agent respond with **declarative UI**, not just text — a JSON
description of components (a form, a metric card, a status list) that the
*client* renders using its own registered React components. The model
never emits HTML/JSX; it emits data, and your catalog decides how that
data becomes pixels. This is the same idea as "generative UI" in Vercel's
AI SDK, but protocol-level and framework-agnostic.

Two things a consumer app defines, paired together into a **catalog**:

- **Definitions**: a name → `{ description, props: ZodSchema }` map. This
  is what gets shown to the model (as a schema) so it knows what it's
  allowed to compose.
- **Renderers**: a name → React component map, one per definition, that
  actually draws it.

### 6.2 In this repo

**[plugins/agentic-lab/src/components/a2ui/definitions.ts](plugins/agentic-lab/src/components/a2ui/definitions.ts)**
```ts
export const metricCardDefinition = {
  description: 'A metric card showing a title, value and optional trend',
  props: z.object({ title: z.string(), value: z.string(), trend: z.enum(['up','down','flat']).optional() }),
};
export const myDefinitions = {
  'metric-card': metricCardDefinition,
  'info-form': infoFormDefinition,
  'status-list': statusListDefinition,
};
```
This is a `Record<string, definition>` (keyed by component name) —
`createCatalog`'s `CatalogDefinitions` type is
`Record<string, CatalogComponentDefinition>`, not an array.

**[plugins/agentic-lab/src/components/a2ui/renderers.tsx](plugins/agentic-lab/src/components/a2ui/renderers.tsx)**
```ts
export function MetricCardRenderer({ props }: { props: { title: string; value: string; ... } }) {
  return <div>...</div>;
}
export const myRenderers = {
  'metric-card': MetricCardRenderer,
  'info-form': InfoFormRenderer,
  'status-list': StatusListRenderer,
};
```
Each renderer receives `{ props, children, dispatch }` (the
`ComponentRenderer<T>` shape) — the domain fields live under `props`, not
spread as top-level React props, so a renderer can also invoke `children`
(to render a nested component by id) or `dispatch` (to fire an A2UI action
back to the model, e.g. on a button click).

**[plugins/agentic-lab/src/components/a2ui/catalog.ts](plugins/agentic-lab/src/components/a2ui/catalog.ts)**
```ts
export const myCatalog = createCatalog(myDefinitions, myRenderers, {
  catalogId: 'agentic-lab-catalog',
  includeBasicCatalog: true,   // merges in built-ins: Text, Button, Row, ...
});
```

**[A2UITab.tsx](plugins/agentic-lab/src/components/A2UITab.tsx)** mounts
its *own* `<CopilotKit a2ui={{ catalog: myCatalog }}>` provider (nested
inside the page's shared one), because the catalog must be attached at the
provider level — passing it enables A2UI and auto-injects a
`generate_a2ui` tool for that provider's agent connection.

### 6.3 How generation actually happens

On the ADK side, `ag_ui_adk`'s A2UI subagent
(`ag_ui_adk/a2ui_tool.py`) works around a real LLM limitation: rather than
asking the model to fill a strictly-typed nested schema (which
Gemini-style function calling handles by emitting `{}` for
property-less array-of-object fields), it declares `components` and
`data` as **plain strings** and asks the model to write raw JSON text into
them, parsed back out afterward. This free-form-JSON-in-a-string-field
approach is more forgiving of the model's actual training distribution,
but means the model's output has to be validated and can need retries —
especially for deeply nested shapes like a form's
`fields: [{label, placeholder, required}, ...]` array.

The mitigation is a **validate → retry loop**
(`ag_ui_a2ui_toolkit/recovery.py`, `MAX_A2UI_ATTEMPTS = 3` by default),
each retry re-prompting the model with the previous attempt's validation
error as feedback. This repo raises that budget via
`a2ui={"recovery": {"maxAttempts": 5}}` in `orchestrator.py`, giving
more complex components more room to converge.

There's a separate model *capability* requirement, distinct from
generation quality: A2UI's forced generation uses
`FunctionCallingConfigMode.ANY` (Gemini's "must call this exact tool"
mode), which LiteLLM translates to OpenAI-style
`tool_choice="required"` for non-Gemini models — so the chosen
`AGENT_MODEL` needs to actually support forced tool-calling, not just
tool-calling in general.

---

## 7. Full request walkthrough: "Research quantum computing"

Tracing one message end-to-end through every layer above, in order:

1. **Browser**: user types into `<CopilotChat>` (rendered by
   `A2AOrchestratorTab`). CopilotKit React posts to
   `runtimeUrl` = `http://localhost:4000/copilotkit`, AG-UI protocol,
   `agent: "agentic-lab"`.
2. **Runtime** (`server.mjs`): `CopilotRuntime` looks up
   `agents["agentic-lab"]` → an `A2AMiddlewareAgent`. `InMemoryAgentRunner`
   calls `.clone()` on it for this run, so this turn gets isolated
   message/thread state.
3. **Middleware `.run()`**: builds a system prompt listing "Research
   Agent" and "Analysis Agent" (from the cards fetched at startup),
   appends the `send_message_to_a2a_agent` tool declaration, and calls
   `orchestrationAgent.run()` — an `HttpAgent` POST to
   `http://localhost:8000` (AG-UI, again).
4. **Orchestrator** (`orchestrator.py`, via `ag_ui_adk`'s `ADKAgent`):
   builds a per-run ADK `LlmAgent` context, resolves `AGUIToolset()` into
   a `ClientProxyToolset` from whatever tools were forwarded (here: just
   `send_message_to_a2a_agent`), and calls the model. The model's
   response is a tool call:
   `send_message_to_a2a_agent({agentName: "Research Agent", task: "..."})`.
   ADK streams this back as `TOOL_CALL_START`/`ARGS`/`END` AG-UI events.
5. **Middleware, again**: sees the `TOOL_CALL_START` name matches
   `send_message_to_a2a_agent`, intercepts it. Looks up "Research Agent"
   in its `agentClients`, and calls `A2AClient.sendMessage()` — a fresh
   HTTP call, **A2A protocol this time**, to `http://localhost:9001`.
6. **Research Agent** (`research_agent.py`, an independent A2A server):
   `ResearchAgentExecutor.execute()` receives the task, runs its *own*
   internal ADK `LlmAgent`/`Runner`/`SessionService` (a completely separate
   ADK instance from the orchestrator's), and returns the summarized text
   via `EventQueue`.
7. **Middleware**: receives the A2A response, injects a synthetic
   `TOOL_CALL_RESULT` event into the stream flowing back toward the
   browser, appends that result as a tool message, and triggers a **second
   run** against the orchestrator so it can synthesize a final answer
   incorporating the research.
8. **Orchestrator, again**: this time the model has the tool result in
   context and no more tools to call — it streams a final
   `TEXT_MESSAGE_*` sequence.
9. **Runtime → Browser**: all of steps 3-8's events (including the
   synthetic tool-call/result the middleware manufactured) flow back over
   the original SSE connection. CopilotKit React reassembles them:
   `A2AOrchestratorTab`'s `useRenderTool` renderer draws the
   "Orchestrator → Research Agent" / "Research Agent → Orchestrator" cards
   from the tool-call events, and `<CopilotChat>` renders the final text.

Two full network hops you might not expect from reading only the frontend
code: the *middleware re-running the orchestrator a second time* (step 7),
and the *research agent running its own private ADK stack* (step 6) —
neither is visible unless you read `server.mjs` and the agent files
directly.

---

## 8. Full request walkthrough: "Show me a deployment status dashboard"

The A2UI tab's request path shares most of its plumbing with §7 — same
runtime, same middleware, same orchestrator — but diverges once the model
decides to compose UI instead of calling an A2A agent.

1. **Browser**: user types into `<CopilotChat>` inside `A2UITab`'s own
   nested `<CopilotKit a2ui={{ catalog: myCatalog }}>` provider. Because
   this provider was given a catalog, CopilotKit React extracts the
   catalog's schema (component names, descriptions, prop shapes) and
   marks this run as A2UI-enabled when it forwards the request to the
   runtime.
2. **Runtime** (`server.mjs`): routes to the same `agents["agentic-lab"]`
   `A2AMiddlewareAgent` the A2A tab uses (both tabs share one agent
   configuration). `InMemoryAgentRunner` clones it for this run as usual;
   the middleware's own `.run()` still appends its
   `send_message_to_a2a_agent` tool declaration, but otherwise passes the
   A2UI schema/flag through untouched on its way to
   `orchestrationAgent.run()` — an `HttpAgent` POST to `http://localhost:8000`.
3. **Orchestrator** (`ADKAgent`): sees the forwarded A2UI flag and, since
   `orchestrator.py` opts in via `a2ui={"recovery": {"maxAttempts": 5}}`,
   injects a `generate_a2ui` tool onto the per-run root `LlmAgent` —
   inferring which model to use for it from the root agent's own
   `canonical_model`.
4. **Model call #1**: the orchestrator calls the model with
   `generate_a2ui` now available alongside the usual tools. The model
   decides "show me a dashboard" calls for generative UI and emits a
   `generate_a2ui` tool call describing the intent (e.g. "create a
   deployment status dashboard").
5. **A2UI subagent** (`ag_ui_adk/a2ui_tool.py`): intercepts that call
   rather than treating it as a normal tool result. It builds a
   *separate*, forced-tool-call `LlmRequest` — `system_instruction` set to
   a composition guide built from the catalog's schema and guidelines,
   `tool_config.function_calling_config.mode = ANY` so the model *must*
   call a `render_a2ui` tool this time, with `components`/`data` declared
   as plain strings (not nested schemas) for the model to write raw JSON
   text into.
6. **Model call #2 (forced)**: the model emits `render_a2ui` with a JSON
   string body. `a2ui_tool.py` parses that string back into structured
   data and validates it against `myDefinitions` (the same schema the
   catalog declared in §6.2). If validation fails, the
   validate → retry loop (`ag_ui_a2ui_toolkit/recovery.py`) re-prompts the
   model with the specific validation error, up to `maxAttempts` (5, per
   `orchestrator.py`'s config) times.
7. **Envelope**: once a valid payload is produced, the subagent builds an
   A2UI **envelope** — a description of the surface and the operations
   needed to create it — and returns that as the `generate_a2ui` tool's
   result. ADK streams this back as ordinary `TOOL_CALL_START`/`ARGS`/
   `RESULT` AG-UI events over the still-open connection to the runtime.
8. **Middleware, again**: `A2AMiddlewareAgent`'s stream-watching logic
   only intercepts tool calls named `send_message_to_a2a_agent` (§5.4);
   `generate_a2ui`/`render_a2ui` events don't match, so they pass straight
   through untouched.
9. **Runtime → Browser**: the SSE stream carries the tool-call/result
   events to CopilotKit React's A2UI integration. Because this provider
   was given `a2ui={{ catalog: myCatalog }}`, it recognizes the envelope,
   looks up each named component in the catalog's renderers
   (`metric-card` → `MetricCardRenderer`, etc. — §6.2), and renders the
   composed surface inline in the chat. `A2UITab.tsx` never has to parse
   the envelope itself — the provider handles the whole render step.

The two model calls in steps 4 and 6 are easy to miss from the outside:
one visible-looking user turn actually drives *two* separate LLM
invocations — a normal one that decides to use `generate_a2ui`, and a
second, forced one (potentially repeated several times via the recovery
loop) that's solely responsible for producing valid component JSON.

---

## 9. Where to go deeper

- **Backstage new frontend system**: read `@backstage/frontend-plugin-api`'s
  other Blueprints (`ApiBlueprint`, `NavItemBlueprint`) and try adding a
  second page or a sidebar nav item by hand.
- **CopilotKit**: read the bundled skill docs directly —
  `node_modules/@copilotkit/react-core/skills/react-core/references/*.md`
  — dense, focused references on exactly these hooks and patterns.
- **AG-UI**: read `@ag-ui/client`'s `AbstractAgent` source directly; try
  writing an agent from scratch that only emits `TEXT_MESSAGE_*` events
  (no framework) and point `<CopilotKit runtimeUrl>` at it.
- **ADK**: try swapping `InMemorySessionService` for a persistent one and
  see what session identity actually needs to survive a process restart.
- **A2A**: stand up a *third* A2A agent and add it to
  `A2AMiddlewareAgent({ agentUrls: [...] })` — no orchestrator prompt
  changes needed beyond mentioning it exists.
- **A2UI**: add a fourth catalog component (e.g. a chart) and watch how
  much more retry-prone generation gets as the schema grows.

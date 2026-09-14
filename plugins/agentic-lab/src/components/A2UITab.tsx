import { CopilotChat } from '@copilotkit/react-core/v2';
import { CopilotKit } from '@copilotkit/react-core/v2';
import { myCatalog } from './a2ui/catalog';

/**
 * Tab 3 — A2UI Generative UI.
 *
 * Demonstrates the A2UI spec: the agent composes declarative UI JSON
 * (metric cards, forms, status lists) via the `generate_a2ui` tool, and
 * the client renders it with the registered React components.
 *
 * This tab mounts its own CopilotKit provider with the A2UI catalog —
 * the catalog must be attached at the provider level.
 */
export function A2UITab() {
  return (
    <CopilotKit
      runtimeUrl="http://localhost:4000/copilotkit"
      agent="agentic-lab"
      a2ui={{ catalog: myCatalog }}
    >
      <div style={{ height: 560 }}>
        <CopilotChat
          labels={{
            modalHeaderTitle: 'A2UI Generative UI',
            welcomeMessageText:
              'I can compose UIs on demand. Try: "Show me a deployment ' +
              'status dashboard" or "Create a form to collect incident details".',
          }}
        />
      </div>
    </CopilotKit>
  );
}

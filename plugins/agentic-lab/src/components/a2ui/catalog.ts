import { createCatalog } from '@copilotkit/a2ui-renderer';

import { myDefinitions } from './definitions';
import { myRenderers } from './renderers';

/**
 * The A2UI catalog: pairs component schemas (definitions) with their React
 * implementations (renderers). Passed to <CopilotKit a2ui={{ catalog }}>,
 * which auto-enables A2UI and injects the `generate_a2ui` tool so the agent
 * can compose UIs from these components.
 */
export const myCatalog = createCatalog(myDefinitions, myRenderers, {
  catalogId: 'agentic-lab-catalog',
  includeBasicCatalog: true,
});

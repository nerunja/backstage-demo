import { CopilotChat } from '@copilotkit/react-core/v2';
import { useFrontendTool } from '@copilotkit/react-core/v2';
import { useApi } from '@backstage/frontend-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { z } from 'zod';

/**
 * Tab 1 — DevOps Assistant.
 *
 * Demonstrates AG-UI frontend tools: the agent can call
 * `list_catalog_entities`, which executes IN THE BROWSER against the
 * Backstage catalog API, and use the result to answer questions like
 * "what services are in the catalog?".
 */
export function DevopsAssistantTab() {
  const catalogApi = useApi(catalogApiRef);

  useFrontendTool({
    name: 'list_catalog_entities',
    description:
      'Lists entities from the Backstage software catalog (services, ' +
      'APIs, resources, etc.). Use this to answer questions about what ' +
      'is registered in the catalog.',
    parameters: z.object({
      filter: z
        .string()
        .optional()
        .describe(
          'Optional filter, e.g. "kind=component" or "type=service". ' +
            'Leave empty to list everything.',
        ),
    }),
    available: true,
    handler: async ({ filter }: { filter?: string }) => {
      const items = await catalogApi.getEntities();
      const entities = items.items.map(e => ({
        kind: e.kind,
        name: e.metadata.name,
        namespace: e.metadata.namespace,
        type: (e.spec as any)?.type ?? null,
        description: e.metadata.description ?? null,
        owner:
          (e.spec as any)?.owner ??
          e.metadata.annotations?.['backstage.io/techdocs-ref'] ??
          null,
      }));
      // ADK's FunctionResponse (the Gemini-style function-calling wire format
      // AGUIToolset uses to relay this result back to the model) requires the
      // response to be a JSON object, not a bare array — so the entities list
      // must be wrapped in a top-level object, not returned as JSON.stringify
      // of the array itself.
      if (filter) {
        const [key, value] = filter.split('=').map(s => s.trim().toLowerCase());
        return JSON.stringify({
          entities: entities.filter(
            e => String((e as any)[key] ?? '').toLowerCase() === value,
          ),
        });
      }
      return JSON.stringify({ entities });
    },
  });

  return (
    <div style={{ height: 560 }}>
      <CopilotChat
        labels={{
          modalHeaderTitle: 'DevOps Assistant',
          welcomeMessageText:
            'Hi! I can answer questions about this Backstage instance. ' +
            'Try: "What services are in the catalog?" or "Summarize the catalog".',
        }}
      />
    </div>
  );
}

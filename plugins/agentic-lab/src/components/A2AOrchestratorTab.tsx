import { CopilotChat, useRenderTool } from '@copilotkit/react-core/v2';
import { z } from 'zod';

type A2AMessageProps = {
  status: 'inProgress' | 'executing' | 'complete';
  args: { agentName?: string; task?: string };
};

const AGENT_STYLES: Record<string, { color: string; icon: string }> = {
  'Research Agent': { color: '#7c4dff', icon: '🔍' },
  'Analysis Agent': { color: '#00897b', icon: '💡' },
};

function agentStyle(name?: string) {
  return AGENT_STYLES[name ?? ''] ?? { color: '#546e7a', icon: '🤖' };
}

/** Message from the orchestrator to an A2A agent. */
function MessageToA2A({ status, args }: A2AMessageProps) {
  if (status !== 'executing' && status !== 'complete') return null;
  if (!args.agentName || !args.task) return null;
  const style = agentStyle(args.agentName);
  return (
    <div
      style={{
        background: '#f4fff8',
        border: '1px solid #c8e6c9',
        borderRadius: 8,
        padding: '12px 16px',
        margin: '8px 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          style={{
            background: '#37474f',
            color: '#fff',
            borderRadius: 999,
            padding: '4px 12px',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Orchestrator
        </span>
        <span style={{ color: '#90a4ae' }}>→</span>
        <span
          style={{
            border: `2px solid ${style.color}`,
            color: style.color,
            borderRadius: 999,
            padding: '4px 12px',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {style.icon} {args.agentName}
        </span>
        <span
          style={{
            color: '#455a64',
            fontSize: 13,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={args.task}
        >
          {args.task}
        </span>
      </div>
    </div>
  );
}

/** Response from an A2A agent back to the orchestrator. */
function MessageFromA2A({ status, args }: A2AMessageProps) {
  if (status !== 'complete') return null;
  if (!args.agentName) return null;
  const style = agentStyle(args.agentName);
  return (
    <div
      style={{
        background: '#f0f7ff',
        border: '1px solid #bbdefb',
        borderRadius: 8,
        padding: '12px 16px',
        margin: '8px 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          style={{
            border: `2px solid ${style.color}`,
            color: style.color,
            borderRadius: 999,
            padding: '4px 12px',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {style.icon} {args.agentName}
        </span>
        <span style={{ color: '#90a4ae' }}>→</span>
        <span
          style={{
            background: '#37474f',
            color: '#fff',
            borderRadius: 999,
            padding: '4px 12px',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Orchestrator
        </span>
        <span style={{ color: '#546e7a', fontSize: 12 }}>✓ Response received</span>
      </div>
    </div>
  );
}

/**
 * Tab 2 — A2A Orchestrator.
 *
 * Demonstrates the A2A protocol: the CopilotKit A2A middleware injects the
 * `send_message_to_a2a_agent` tool into the ADK orchestrator, which delegates
 * to the Research and Analysis agents. This attaches a renderer to that
 * *existing* tool to show the agent-to-agent traffic as cards inside the
 * chat — it must NOT use `useFrontendTool`, which declares a brand new tool.
 * Since the middleware already injects a `send_message_to_a2a_agent`
 * declaration server-side, doing that here registers a second, colliding
 * declaration with the same name; ADK logs "Duplicate tool name ... shadowed"
 * and the run silently stalls forever (the middleware can't find the
 * tool-call arguments it needs to relay the call).
 */
export function A2AOrchestratorTab() {
  useRenderTool({
    name: 'send_message_to_a2a_agent',
    parameters: z.object({
      agentName: z
        .string()
        .describe('The name of the A2A agent to send the message to'),
      task: z.string().describe('The message to send to the A2A agent'),
    }),
    render: (actionRenderProps: any) => (
      <>
        <MessageToA2A {...actionRenderProps} />
        <MessageFromA2A {...actionRenderProps} />
      </>
    ),
  });

  return (
    <div style={{ height: 560 }}>
      <CopilotChat
        labels={{
          modalHeaderTitle: 'A2A Orchestrator',
          welcomeMessageText:
            'I coordinate specialized agents over the A2A protocol. ' +
            'Try: "Research quantum computing" — I will delegate to the ' +
            'Research Agent, then pass its findings to the Analysis Agent.',
        }}
      />
    </div>
  );
}

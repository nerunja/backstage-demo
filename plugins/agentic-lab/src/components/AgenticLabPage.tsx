import { useState } from 'react';
import { Header, Page } from '@backstage/core-components';
import { CopilotKit } from '@copilotkit/react-core/v2';
import { DevopsAssistantTab } from './DevopsAssistantTab';
import { A2AOrchestratorTab } from './A2AOrchestratorTab';
import { A2UITab } from './A2UITab';

const RUNTIME_URL = 'http://localhost:4000/copilotkit';

const TABS = [
  { id: 'devops', label: 'DevOps Assistant' },
  { id: 'a2a', label: 'A2A Orchestrator' },
  { id: 'a2ui', label: 'A2UI Generative UI' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Agentic Lab page — a playground for agentic UX in Backstage.
 *
 * All tabs share one CopilotKit runtime (AG-UI) pointing at the ADK
 * orchestrator; each tab demonstrates a different agentic protocol:
 *  1. DevOps assistant — frontend tools over the Backstage catalog
 *  2. A2A orchestrator — agent-to-agent traffic visualization
 *  3. A2UI — agent-generated declarative UI
 */
export function AgenticLabPage() {
  const [tab, setTab] = useState<TabId>('devops');

  return (
    <Page themeId="home">
      <Header
        title="Agentic Lab"
        subtitle="CopilotKit × AG-UI × A2UI × A2A × ADK"
      />
      <CopilotKit runtimeUrl={RUNTIME_URL} agent="agentic-lab">
        <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border:
                    tab === t.id ? '1px solid #465af0' : '1px solid #ddd',
                  background: tab === t.id ? '#eef1ff' : 'transparent',
                  fontWeight: tab === t.id ? 600 : 400,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'devops' && <DevopsAssistantTab />}
          {tab === 'a2a' && <A2AOrchestratorTab />}
          {tab === 'a2ui' && <A2UITab />}
        </div>
      </CopilotKit>
    </Page>
  );
}

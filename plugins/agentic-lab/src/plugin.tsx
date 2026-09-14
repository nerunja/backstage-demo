import {
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import MemoryIcon from '@material-ui/icons/Memory';
import { rootRouteRef } from './routes';
/**
 * The Agentic Lab page extension. Page extensions are lazily loaded and
 * automatically appear in the app sidebar with the given title and icon.
 */
const agenticLabPage = PageBlueprint.make({
  params: {
    routeRef: rootRouteRef,
    path: '/agentic-lab',
    title: 'Agentic Lab',
    icon: <MemoryIcon />,
    loader: () =>
      import('./components/AgenticLabPage').then(m => <m.AgenticLabPage />),
  },
});

/**
 * The Agentic Lab plugin: a playground for agentic UX in Backstage,
 * combining CopilotKit, AG-UI, A2UI, A2A and Google ADK.
 */
export const agenticLabPlugin = createFrontendPlugin({
  pluginId: 'agentic-lab',
  extensions: [agenticLabPage],
  routes: {
    root: rootRouteRef,
  },
});

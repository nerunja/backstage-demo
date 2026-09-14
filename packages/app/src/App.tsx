import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import agenticLabPlugin from '@nerunja/backstage-plugin-agentic-lab';
import { navModule } from './modules/nav';
import { homeModule } from './modules/home';

export default createApp({
  features: [catalogPlugin, agenticLabPlugin, navModule, homeModule],
});

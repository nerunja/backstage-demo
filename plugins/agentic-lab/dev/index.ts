import { createDevApp } from '@backstage/frontend-dev-utils';
import agenticLabPlugin from '../src';

createDevApp({
  features: [agenticLabPlugin],
});

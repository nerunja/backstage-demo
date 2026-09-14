import { z } from 'zod';

/**
 * A2UI component definitions for the Agentic Lab.
 *
 * These are the schemas the agent's `generate_a2ui` tool can compose.
 * Each definition maps to a React renderer in `./renderers.tsx`.
 */

export const metricCardDefinition = {
  description: 'A metric card showing a title, value and optional trend',
  props: z.object({
    title: z.string().describe('Metric title'),
    value: z.string().describe('Metric value, e.g. "42" or "$1.2M"'),
    trend: z
      .enum(['up', 'down', 'flat'])
      .optional()
      .describe('Trend direction'),
    description: z.string().optional().describe('Short explanation'),
  }),
};

export const infoFormDefinition = {
  description: 'A form for collecting information from the user',
  props: z.object({
    title: z.string().describe('Form title'),
    fields: z
      .array(
        z.object({
          label: z.string().describe('Field label'),
          placeholder: z.string().optional(),
          required: z
            .boolean()
            .optional()
            .describe('Whether the field is required'),
        }),
      )
      .describe('Form fields to collect'),
    submitLabel: z.string().optional().describe('Submit button label'),
  }),
};

export const statusListDefinition = {
  description: 'A list of items with a health status each',
  props: z.object({
    title: z.string().describe('List title'),
    items: z
      .array(
        z.object({
          name: z.string().describe('Item name'),
          status: z
            .enum(['healthy', 'warning', 'error'])
            .describe('Item status'),
          detail: z.string().optional().describe('Optional detail'),
        }),
      )
      .describe('Items to display'),
  }),
};

export const myDefinitions = {
  'metric-card': metricCardDefinition,
  'info-form': infoFormDefinition,
  'status-list': statusListDefinition,
};

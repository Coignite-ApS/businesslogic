import type { PropDef } from './types.js';

export interface ComponentEntry {
  tag: string;
  category: 'layout' | 'input' | 'output' | 'content';
  label: string;
  description: string;
  canHaveChildren: boolean;
  validChildren?: string[];
  propSchema?: Record<string, PropDef>;
}

const registry = new Map<string, ComponentEntry>();

/** Register a component under one or more names */
export function registerComponent(names: string[], entry: ComponentEntry): void {
  for (const name of names) {
    registry.set(name, entry);
  }
}

/** Look up a component by LayoutNode type or ChatKit name */
export function getComponent(name: string): ComponentEntry | null {
  return registry.get(name) ?? null;
}

/** List all unique components */
export function listComponents(): ComponentEntry[] {
  const seen = new Set<string>();
  const result: ComponentEntry[] = [];
  for (const entry of registry.values()) {
    if (!seen.has(entry.tag)) {
      seen.add(entry.tag);
      result.push(entry);
    }
  }
  return result;
}

/** List components by category */
export function getComponentsByCategory(category: ComponentEntry['category']): ComponentEntry[] {
  return listComponents().filter(e => e.category === category);
}

/** Get all registered names */
export function getRegisteredNames(): string[] {
  return Array.from(registry.keys());
}

// ── Layout ────────────────────────────────────────────────────────────────────

registerComponent(['root', 'Root'], {
  tag: 'bl-root',
  category: 'layout',
  label: 'Root',
  description: 'Top-level widget container',
  canHaveChildren: true,
});

registerComponent(['section', 'Section'], {
  tag: 'bl-section',
  category: 'layout',
  label: 'Section',
  description: 'Vertical content section with optional title',
  canHaveChildren: true,
});

registerComponent(['row', 'Row'], {
  tag: 'bl-row',
  category: 'layout',
  label: 'Row',
  description: 'Horizontal flex row',
  canHaveChildren: true,
});

registerComponent(['col', 'Col'], {
  tag: 'bl-col',
  category: 'layout',
  label: 'Column',
  description: 'Flex column within a row',
  canHaveChildren: true,
});

registerComponent(['card', 'Card'], {
  tag: 'bl-card',
  category: 'layout',
  label: 'Card',
  description: 'Elevated card container',
  canHaveChildren: true,
});

// ── Inputs ────────────────────────────────────────────────────────────────────

registerComponent(['text-input', 'Input'], {
  tag: 'bl-text-input',
  category: 'input',
  label: 'Text Input',
  description: 'Single-line text field',
  canHaveChildren: false,
});

registerComponent(['dropdown', 'Select'], {
  tag: 'bl-dropdown',
  category: 'input',
  label: 'Dropdown',
  description: 'Select from a list of options',
  canHaveChildren: false,
});

registerComponent(['checkbox', 'Checkbox'], {
  tag: 'bl-checkbox',
  category: 'input',
  label: 'Checkbox',
  description: 'Boolean toggle',
  canHaveChildren: false,
});

registerComponent(['number-stepper', 'NumberStepper'], {
  tag: 'bl-number-stepper',
  category: 'input',
  label: 'Number Stepper',
  description: 'Numeric input with increment/decrement controls',
  canHaveChildren: false,
});

registerComponent(['slider', 'Slider'], {
  tag: 'bl-slider',
  category: 'input',
  label: 'Slider',
  description: 'Range slider for numeric input',
  canHaveChildren: false,
});

registerComponent(['radio-group', 'RadioGroup'], {
  tag: 'bl-radio-group',
  category: 'input',
  label: 'Radio Group',
  description: 'Single-select radio buttons',
  canHaveChildren: false,
});

registerComponent(['date-picker', 'DatePicker'], {
  tag: 'bl-date-picker',
  category: 'input',
  label: 'Date Picker',
  description: 'Date selection input',
  canHaveChildren: false,
});

// ── Outputs ───────────────────────────────────────────────────────────────────

registerComponent(['metric', 'Metric'], {
  tag: 'bl-metric',
  category: 'output',
  label: 'Metric',
  description: 'Single KPI value with label',
  canHaveChildren: false,
});

registerComponent(['text', 'Text'], {
  tag: 'bl-text',
  category: 'output',
  label: 'Text',
  description: 'Formatted text output',
  canHaveChildren: false,
});

registerComponent(['table', 'Table'], {
  tag: 'bl-table',
  category: 'output',
  label: 'Table',
  description: 'Data table',
  canHaveChildren: false,
});

registerComponent(['gauge', 'Gauge'], {
  tag: 'bl-gauge',
  category: 'output',
  label: 'Gauge',
  description: 'Circular gauge chart',
  canHaveChildren: false,
});

registerComponent(['bar-chart', 'BarChart'], {
  tag: 'bl-bar-chart',
  category: 'output',
  label: 'Bar Chart',
  description: 'Vertical or horizontal bar chart',
  canHaveChildren: false,
});

registerComponent(['line-chart', 'LineChart'], {
  tag: 'bl-line-chart',
  category: 'output',
  label: 'Line Chart',
  description: 'Time series line chart',
  canHaveChildren: false,
});

registerComponent(['pie-chart', 'PieChart'], {
  tag: 'bl-pie-chart',
  category: 'output',
  label: 'Pie Chart',
  description: 'Pie chart',
  canHaveChildren: false,
});

registerComponent(['donut-chart', 'DonutChart'], {
  tag: 'bl-donut-chart',
  category: 'output',
  label: 'Donut Chart',
  description: 'Donut chart',
  canHaveChildren: false,
});

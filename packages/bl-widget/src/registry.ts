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

// ── Layout (new) ──────────────────────────────────────────────────────────────

registerComponent(['box', 'Box'], {
  tag: 'bl-box',
  category: 'layout',
  label: 'Box',
  description: 'Generic flex container',
  canHaveChildren: true,
});

registerComponent(['spacer', 'Spacer'], {
  tag: 'bl-spacer',
  category: 'layout',
  label: 'Spacer',
  description: 'Flexible space filler',
  canHaveChildren: false,
});

registerComponent(['divider', 'Divider'], {
  tag: 'bl-divider',
  category: 'layout',
  label: 'Divider',
  description: 'Horizontal separator',
  canHaveChildren: false,
});

registerComponent(['list-view', 'ListView'], {
  tag: 'bl-list-view',
  category: 'layout',
  label: 'List View',
  description: 'Scrollable list with show-more',
  canHaveChildren: true,
  validChildren: ['list-view-item', 'ListViewItem'],
});

registerComponent(['list-view-item', 'ListViewItem'], {
  tag: 'bl-list-view-item',
  category: 'layout',
  label: 'List View Item',
  description: 'Row in a list view',
  canHaveChildren: true,
});

registerComponent(['basic', 'Basic'], {
  tag: 'bl-basic',
  category: 'layout',
  label: 'Basic',
  description: 'Minimal container',
  canHaveChildren: true,
});

registerComponent(['transition', 'Transition'], {
  tag: 'bl-transition',
  category: 'layout',
  label: 'Transition',
  description: 'Animated container',
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

// ── Inputs (new) ──────────────────────────────────────────────────────────────

registerComponent(['form', 'Form'], {
  tag: 'bl-form',
  category: 'input',
  label: 'Form',
  description: 'Form with state capture and submit action',
  canHaveChildren: true,
});

registerComponent(['textarea', 'Textarea'], {
  tag: 'bl-textarea',
  category: 'input',
  label: 'Textarea',
  description: 'Multi-line text input',
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

registerComponent(['chart', 'Chart'], {
  tag: 'bl-chart',
  category: 'output',
  label: 'Chart',
  description: 'Unified chart component',
  canHaveChildren: false,
});

// ── Content ───────────────────────────────────────────────────────────────────

registerComponent(['title', 'Title'], {
  tag: 'bl-title',
  category: 'content',
  label: 'Title',
  description: 'Heading text',
  canHaveChildren: false,
});

registerComponent(['caption', 'Caption'], {
  tag: 'bl-caption',
  category: 'content',
  label: 'Caption',
  description: 'Helper text',
  canHaveChildren: false,
});

registerComponent(['badge', 'Badge'], {
  tag: 'bl-badge',
  category: 'content',
  label: 'Badge',
  description: 'Status badge',
  canHaveChildren: false,
});

registerComponent(['button', 'Button'], {
  tag: 'bl-button',
  category: 'content',
  label: 'Button',
  description: 'Clickable button with action',
  canHaveChildren: false,
});

registerComponent(['icon', 'Icon'], {
  tag: 'bl-icon',
  category: 'content',
  label: 'Icon',
  description: 'SVG icon',
  canHaveChildren: false,
});

registerComponent(['image', 'Image'], {
  tag: 'bl-image',
  category: 'content',
  label: 'Image',
  description: 'Image display',
  canHaveChildren: false,
});

registerComponent(['markdown', 'Markdown'], {
  tag: 'bl-markdown',
  category: 'content',
  label: 'Markdown',
  description: 'Markdown text renderer',
  canHaveChildren: false,
});

registerComponent(['label', 'Label'], {
  tag: 'bl-label',
  category: 'content',
  label: 'Label',
  description: 'Form field label',
  canHaveChildren: false,
});

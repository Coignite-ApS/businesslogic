// Main entry — registers <bl-calculator> custom element
export { BlCalculator } from './bl-calculator.js';

// Components (for programmatic use)
export { BlTextInput } from './components/inputs/bl-text-input.js';
export { BlDropdown } from './components/inputs/bl-dropdown.js';
export { BlCheckbox } from './components/inputs/bl-checkbox.js';
export { BlNumberStepper } from './components/inputs/bl-number-stepper.js';
export { BlMetric } from './components/outputs/bl-metric.js';
export { BlText } from './components/outputs/bl-text.js';
export { BlRoot } from './components/layout/bl-root.js';
export { BlSection } from './components/layout/bl-section.js';
export { BlRow } from './components/layout/bl-row.js';
export { BlCol } from './components/layout/bl-col.js';
export { BlCard } from './components/layout/bl-card.js';

// Utilities
export { ApiClient } from './api-client.js';
export { generateLayout, mapInputComponent, mapOutputComponent } from './auto-layout.js';
export { renderNode } from './layout-renderer.js';
export { defaultThemeVars, buildThemeStyle } from './theme.js';

// Types
export type {
  LayoutConfig,
  LayoutNode,
  WidgetConfig,
  DescribeResponse,
  JsonSchema,
  SchemaProperty,
  FieldMeta,
} from './types.js';

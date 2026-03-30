// Main entry — registers <bl-calculator> custom element
export { BlCalculator } from './bl-calculator.js';

// Programmatic API
export { Calculator } from './calculator.js';
export type { CalculatorOptions } from './calculator.js';

// Input components
export { BlTextInput } from './components/inputs/bl-text-input.js';
export { BlDropdown } from './components/inputs/bl-dropdown.js';
export { BlCheckbox } from './components/inputs/bl-checkbox.js';
export { BlNumberStepper } from './components/inputs/bl-number-stepper.js';
export { BlSlider } from './components/inputs/bl-slider.js';
export { BlRadioGroup } from './components/inputs/bl-radio-group.js';
export { BlDatePicker } from './components/inputs/bl-date-picker.js';

// Output components
export { BlMetric } from './components/outputs/bl-metric.js';
export { BlText } from './components/outputs/bl-text.js';
export { BlTable } from './components/outputs/bl-table.js';
export { BlGauge } from './components/outputs/bl-gauge.js';
export { BlBarChart } from './components/outputs/bl-bar-chart.js';
export { BlLineChart } from './components/outputs/bl-line-chart.js';
export { BlPieChart } from './components/outputs/bl-pie-chart.js';
export { BlDonutChart } from './components/outputs/bl-donut-chart.js';

// Layout components
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

// Registry
export {
  getComponent,
  registerComponent,
  listComponents,
  getComponentsByCategory,
  getRegisteredNames,
} from './registry.js';
export type { ComponentEntry } from './registry.js';

// Actions
export { BlActionEvent } from './actions.js';
export type { ActionConfig } from './actions.js';

// Types
export type {
  LayoutConfig,
  LayoutNode,
  WidgetConfig,
  DescribeResponse,
  JsonSchema,
  SchemaProperty,
  FieldMeta,
  ChatKitNode,
  RenderableNode,
  PropDef,
} from './types.js';

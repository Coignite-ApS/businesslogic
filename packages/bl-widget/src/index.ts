// Main entry — registers <bl-calculator> custom element
export { BlCalculator } from './bl-calculator.js';

// Programmatic API
export { Calculator } from './calculator.js';
export type { CalculatorOptions } from './calculator.js';

// Input components
export { BlTextInput } from './components/inputs/bl-text-input.js';
// Form/Input components (new)
export { BlForm } from './components/inputs/bl-form.js';
export { BlTextarea } from './components/inputs/bl-textarea.js';
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
// Layout components (new)
export { BlBox } from './components/layout/bl-box.js';
export { BlSpacer } from './components/layout/bl-spacer.js';
export { BlDivider } from './components/layout/bl-divider.js';
export { BlListView } from './components/layout/bl-list-view.js';
export { BlListViewItem } from './components/layout/bl-list-view-item.js';
export { BlBasic } from './components/layout/bl-basic.js';
export { BlTransition } from './components/layout/bl-transition.js';

// Content components
export { BlTitle } from './components/content/bl-title.js';
export { BlCaption } from './components/content/bl-caption.js';
export { BlBadge } from './components/content/bl-badge.js';
export { BlButton } from './components/content/bl-button.js';
export { BlIcon } from './components/content/bl-icon.js';
export { BlImage } from './components/content/bl-image.js';
export { BlMarkdown } from './components/content/bl-markdown.js';
export { BlLabel } from './components/content/bl-label.js';

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

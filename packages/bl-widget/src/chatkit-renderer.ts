import type { ChatKitNode } from './types.js';
import { getComponent } from './registry.js';

// Import all components to ensure custom elements are registered
import './components/layout/bl-root.js';
import './components/layout/bl-section.js';
import './components/layout/bl-row.js';
import './components/layout/bl-col.js';
import './components/layout/bl-card.js';
import './components/layout/bl-box.js';
import './components/layout/bl-spacer.js';
import './components/layout/bl-divider.js';
import './components/layout/bl-list-view.js';
import './components/layout/bl-list-view-item.js';
import './components/layout/bl-basic.js';
import './components/layout/bl-transition.js';
import './components/inputs/bl-text-input.js';
import './components/inputs/bl-dropdown.js';
import './components/inputs/bl-checkbox.js';
import './components/inputs/bl-number-stepper.js';
import './components/inputs/bl-slider.js';
import './components/inputs/bl-radio-group.js';
import './components/inputs/bl-date-picker.js';
import './components/inputs/bl-form.js';
import './components/inputs/bl-textarea.js';
import './components/outputs/bl-metric.js';
import './components/outputs/bl-text.js';
import './components/outputs/bl-table.js';
import './components/outputs/bl-gauge.js';
import './components/outputs/bl-bar-chart.js';
import './components/outputs/bl-line-chart.js';
import './components/outputs/bl-pie-chart.js';
import './components/outputs/bl-donut-chart.js';
import './components/outputs/bl-chart.js';
import './components/content/bl-title.js';
import './components/content/bl-caption.js';
import './components/content/bl-badge.js';
import './components/content/bl-button.js';
import './components/content/bl-icon.js';
import './components/content/bl-image.js';
import './components/content/bl-markdown.js';
import './components/content/bl-label.js';

/** Render a ChatKit component tree to a DOM element (imperative) */
export function renderChatKitTree(node: ChatKitNode | null | undefined): HTMLElement | null {
  if (!node?.component) return null;

  const entry = getComponent(node.component);
  if (!entry) {
    const div = document.createElement('div');
    div.textContent = `[Unknown: ${node.component}]`;
    div.style.color = 'red';
    div.style.fontSize = '12px';
    return div;
  }

  const el = document.createElement(entry.tag);

  // Set properties
  const props = node.props || {};
  for (const [key, value] of Object.entries(props)) {
    try {
      (el as unknown as Record<string, unknown>)[key] = value;
    } catch {
      el.setAttribute(key, String(value));
    }
  }

  // Render children recursively
  if (node.children) {
    for (const child of node.children) {
      const childEl = renderChatKitTree(child);
      if (childEl) el.appendChild(childEl);
    }
  }

  return el;
}

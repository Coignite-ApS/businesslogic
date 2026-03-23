import { html, nothing, type TemplateResult } from 'lit';
import type { LayoutNode, JsonSchema } from './types.js';

// Import all components so custom elements get registered
import './components/layout/bl-root.js';
import './components/layout/bl-section.js';
import './components/layout/bl-row.js';
import './components/layout/bl-col.js';
import './components/layout/bl-card.js';
import './components/inputs/bl-text-input.js';
import './components/inputs/bl-dropdown.js';
import './components/inputs/bl-checkbox.js';
import './components/inputs/bl-number-stepper.js';
import './components/outputs/bl-metric.js';
import './components/outputs/bl-text.js';

export interface RenderContext {
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  values: Record<string, unknown>;
  outputs: Record<string, unknown>;
  onInput: (field: string, value: unknown) => void;
}

/** Render a layout node tree into Lit templates */
export function renderNode(node: LayoutNode, ctx: RenderContext): TemplateResult | typeof nothing {
  const props = node.props || {};
  const field = node.field;

  // Resolve field metadata from schema
  const isInput = field ? field in (ctx.inputSchema.properties || {}) : false;
  const schema = field
    ? (isInput ? ctx.inputSchema.properties[field] : ctx.outputSchema.properties[field])
    : undefined;
  const label = schema?.title || field || '';
  const description = schema?.description || '';

  switch (node.type) {
    // Layout containers
    case 'root':
      return html`<bl-root>${renderChildren(node, ctx)}</bl-root>`;
    case 'section':
      return html`<bl-section label=${node.slot || ''}>${renderChildren(node, ctx)}</bl-section>`;
    case 'row':
      return html`<bl-row>${renderChildren(node, ctx)}</bl-row>`;
    case 'col':
      return html`<bl-col .width=${props.width || 'auto'}>${renderChildren(node, ctx)}</bl-col>`;
    case 'card':
      return html`<bl-card label=${props.title || ''}>${renderChildren(node, ctx)}</bl-card>`;

    // Input components
    case 'text-input':
      return html`<bl-text-input
        .field=${field || ''}
        .label=${label}
        .description=${description}
        .value=${String(ctx.values[field!] ?? schema?.default ?? '')}
        .inputType=${schema?.type === 'number' ? 'number' : 'text'}
        .min=${props.min ?? schema?.minimum}
        .max=${props.max ?? schema?.maximum}
        @bl-input=${(e: CustomEvent) => ctx.onInput(field!, e.detail.value)}
      ></bl-text-input>`;

    case 'dropdown':
      return html`<bl-dropdown
        .field=${field || ''}
        .label=${label}
        .description=${description}
        .value=${ctx.values[field!] ?? schema?.default ?? ''}
        .options=${schema?.oneOf || schema?.enum?.map((v: unknown) => ({ const: v, title: String(v) })) || []}
        @bl-input=${(e: CustomEvent) => ctx.onInput(field!, e.detail.value)}
      ></bl-dropdown>`;

    case 'checkbox':
      return html`<bl-checkbox
        .field=${field || ''}
        .label=${label}
        .description=${description}
        .checked=${Boolean(ctx.values[field!] ?? schema?.default ?? false)}
        @bl-input=${(e: CustomEvent) => ctx.onInput(field!, e.detail.value)}
      ></bl-checkbox>`;

    case 'number-stepper':
      return html`<bl-number-stepper
        .field=${field || ''}
        .label=${label}
        .description=${description}
        .value=${Number(ctx.values[field!] ?? schema?.default ?? 0)}
        .min=${props.min ?? schema?.minimum}
        .max=${props.max ?? schema?.maximum}
        .step=${props.step ?? 1}
        @bl-input=${(e: CustomEvent) => ctx.onInput(field!, e.detail.value)}
      ></bl-number-stepper>`;

    // Output components
    case 'metric':
      return html`<bl-metric
        .field=${field || ''}
        .label=${label}
        .value=${ctx.outputs[field!]}
        .format=${props.format || ''}
      ></bl-metric>`;

    case 'text':
      return html`<bl-text
        .field=${field || ''}
        .label=${label}
        .value=${ctx.outputs[field!] ?? ''}
      ></bl-text>`;

    default:
      return html`<div class="bl-unknown">[Unknown: ${node.type}]</div>`;
  }
}

function renderChildren(node: LayoutNode, ctx: RenderContext): TemplateResult[] {
  return (node.children || []).map((child) => renderNode(child, ctx) as TemplateResult);
}

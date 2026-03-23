import type { WidgetComponent, WidgetTheme, WidgetTemplate, DB } from './types.js';

const COMPONENTS: WidgetComponent[] = [
  // Input components
  { slug: 'text-input', name: 'Text Input', description: 'Free text or number input', category: 'input', icon: 'text_fields', renderer_type: 'bl-text-input', default_props: {}, prop_schema: {}, field_types: ['string', 'number'], supports_animation: false, lazy_load: false, sort: 1, status: 'published', version: '1.0' },
  { slug: 'dropdown', name: 'Dropdown', description: 'Fixed option list from enum/oneOf', category: 'input', icon: 'arrow_drop_down_circle', renderer_type: 'bl-dropdown', default_props: {}, prop_schema: {}, field_types: ['string'], supports_animation: false, lazy_load: false, sort: 2, status: 'published', version: '1.0' },
  { slug: 'checkbox', name: 'Checkbox', description: 'Boolean toggle', category: 'input', icon: 'check_box', renderer_type: 'bl-checkbox', default_props: {}, prop_schema: {}, field_types: ['boolean'], supports_animation: false, lazy_load: false, sort: 3, status: 'published', version: '1.0' },
  { slug: 'number-stepper', name: 'Number Stepper', description: 'Integer +/- buttons', category: 'input', icon: 'exposure', renderer_type: 'bl-number-stepper', default_props: { step: 1 }, prop_schema: {}, field_types: ['integer'], supports_animation: false, lazy_load: false, sort: 4, status: 'published', version: '1.0' },
  { slug: 'slider', name: 'Slider', description: 'Numeric range with draggable handle', category: 'input', icon: 'linear_scale', renderer_type: 'bl-slider', default_props: {}, prop_schema: {}, field_types: ['number'], supports_animation: false, lazy_load: false, sort: 5, status: 'published', version: '1.0' },
  { slug: 'radio-group', name: 'Radio Group', description: 'Small option sets (< 5 options)', category: 'input', icon: 'radio_button_checked', renderer_type: 'bl-radio-group', default_props: {}, prop_schema: {}, field_types: ['string'], supports_animation: false, lazy_load: false, sort: 6, status: 'published', version: '1.0' },
  { slug: 'date-picker', name: 'Date Picker', description: 'Date input', category: 'input', icon: 'calendar_today', renderer_type: 'bl-date-picker', default_props: {}, prop_schema: {}, field_types: ['string'], supports_animation: false, lazy_load: false, sort: 7, status: 'published', version: '1.0' },

  // Output components
  { slug: 'metric', name: 'Metric', description: 'Single value with label and formatting', category: 'output', icon: 'speed', renderer_type: 'bl-metric', default_props: {}, prop_schema: {}, field_types: ['number', 'integer'], supports_animation: true, lazy_load: false, sort: 10, status: 'published', version: '1.0' },
  { slug: 'text', name: 'Text', description: 'Formatted text result', category: 'output', icon: 'notes', renderer_type: 'bl-text', default_props: {}, prop_schema: {}, field_types: ['string'], supports_animation: false, lazy_load: false, sort: 11, status: 'published', version: '1.0' },
  { slug: 'table', name: 'Table', description: 'Tabular output', category: 'output', icon: 'table_chart', renderer_type: 'bl-table', default_props: {}, prop_schema: {}, field_types: ['array'], supports_animation: false, lazy_load: false, sort: 12, status: 'published', version: '1.0' },
  { slug: 'bar-chart', name: 'Bar Chart', description: 'Animated bar chart', category: 'output', icon: 'bar_chart', renderer_type: 'bl-bar-chart', default_props: {}, prop_schema: {}, field_types: ['number', 'array'], supports_animation: true, lazy_load: true, sort: 13, status: 'published', version: '1.0' },
  { slug: 'line-chart', name: 'Line Chart', description: 'Animated line chart', category: 'output', icon: 'show_chart', renderer_type: 'bl-line-chart', default_props: {}, prop_schema: {}, field_types: ['number', 'array'], supports_animation: true, lazy_load: true, sort: 14, status: 'published', version: '1.0' },
  { slug: 'pie-chart', name: 'Pie Chart', description: 'Animated pie chart', category: 'output', icon: 'pie_chart', renderer_type: 'bl-pie-chart', default_props: {}, prop_schema: {}, field_types: ['array'], supports_animation: true, lazy_load: true, sort: 15, status: 'published', version: '1.0' },
  { slug: 'donut-chart', name: 'Donut Chart', description: 'Pie variant with center value', category: 'output', icon: 'donut_large', renderer_type: 'bl-donut-chart', default_props: {}, prop_schema: {}, field_types: ['array'], supports_animation: true, lazy_load: true, sort: 16, status: 'published', version: '1.0' },
  { slug: 'gauge', name: 'Gauge', description: 'Animated arc progress indicator', category: 'output', icon: 'speed', renderer_type: 'bl-gauge', default_props: {}, prop_schema: {}, field_types: ['number'], supports_animation: true, lazy_load: false, sort: 17, status: 'published', version: '1.0' },

  // Layout containers
  { slug: 'root', name: 'Root', description: 'Top-level container', category: 'layout', icon: 'crop_free', renderer_type: 'bl-root', default_props: {}, prop_schema: {}, field_types: [], supports_animation: false, lazy_load: false, sort: 20, status: 'published', version: '1.0' },
  { slug: 'section', name: 'Section', description: 'Named section (inputs/outputs slot)', category: 'layout', icon: 'view_agenda', renderer_type: 'bl-section', default_props: {}, prop_schema: {}, field_types: [], supports_animation: false, lazy_load: false, sort: 21, status: 'published', version: '1.0' },
  { slug: 'row', name: 'Row', description: 'Horizontal flex row', category: 'layout', icon: 'view_column', renderer_type: 'bl-row', default_props: {}, prop_schema: {}, field_types: [], supports_animation: false, lazy_load: false, sort: 22, status: 'published', version: '1.0' },
  { slug: 'col', name: 'Column', description: 'Column within row', category: 'layout', icon: 'view_stream', renderer_type: 'bl-col', default_props: {}, prop_schema: {}, field_types: [], supports_animation: false, lazy_load: false, sort: 23, status: 'published', version: '1.0' },
  { slug: 'card', name: 'Card', description: 'Bordered card container', category: 'layout', icon: 'dashboard', renderer_type: 'bl-card', default_props: {}, prop_schema: {}, field_types: [], supports_animation: false, lazy_load: false, sort: 24, status: 'published', version: '1.0' },
];

const THEMES: WidgetTheme[] = [
  {
    slug: 'default', name: 'Default', status: 'published', sort: 1,
    variables: { '--bl-primary': '#3b82f6', '--bl-bg': '#ffffff', '--bl-text': '#1f2937', '--bl-border': '#e5e7eb', '--bl-radius': '8px', '--bl-font': 'system-ui, -apple-system, sans-serif' },
  },
  {
    slug: 'dark', name: 'Dark', status: 'published', sort: 2,
    variables: { '--bl-primary': '#60a5fa', '--bl-bg': '#1f2937', '--bl-text': '#f9fafb', '--bl-border': '#374151', '--bl-radius': '8px', '--bl-font': 'system-ui, -apple-system, sans-serif', '--bl-bg-secondary': '#111827', '--bl-text-secondary': '#9ca3af' },
  },
  {
    slug: 'minimal', name: 'Minimal', status: 'published', sort: 3,
    variables: { '--bl-primary': '#000000', '--bl-bg': '#ffffff', '--bl-text': '#000000', '--bl-border': '#d1d5db', '--bl-radius': '2px', '--bl-font': 'Georgia, serif' },
  },
];

const TEMPLATES: WidgetTemplate[] = [
  {
    slug: 'single-column', name: 'Single Column', description: 'Inputs above outputs in a single column', status: 'published', sort: 1,
    layout_skeleton: { type: 'root', children: [{ type: 'section', slot: 'inputs', children: [] }, { type: 'section', slot: 'outputs', children: [] }] },
  },
  {
    slug: 'two-column', name: 'Two Column', description: 'Inputs on the left, outputs on the right', status: 'published', sort: 2,
    layout_skeleton: { type: 'root', children: [{ type: 'row', children: [{ type: 'col', children: [{ type: 'section', slot: 'inputs', children: [] }] }, { type: 'col', children: [{ type: 'section', slot: 'outputs', children: [] }] }] }] },
  },
  {
    slug: 'card-sidebar', name: 'Card with Sidebar', description: 'Inputs in a card, outputs in a sidebar', status: 'published', sort: 3,
    layout_skeleton: { type: 'root', children: [{ type: 'row', children: [{ type: 'col', props: { width: '60%' }, children: [{ type: 'card', children: [{ type: 'section', slot: 'inputs', children: [] }] }] }, { type: 'col', props: { width: '40%' }, children: [{ type: 'section', slot: 'outputs', children: [] }] }] }] },
  },
];

/** Seed widget collections if empty. Upserts by slug for idempotency. */
export async function seedWidgetData(db: DB, logger: any): Promise<void> {
  try {
    // Check if widget_components table exists
    const hasTable = await db.schema.hasTable('widget_components');
    if (!hasTable) {
      logger.info('[widget-api] widget_components table not found, skipping seed');
      return;
    }

    // Seed components (upsert by slug)
    for (const comp of COMPONENTS) {
      const existing = await db('widget_components').where('slug', comp.slug).first('id');
      if (!existing) {
        await db('widget_components').insert({
          ...comp,
          default_props: JSON.stringify(comp.default_props),
          prop_schema: JSON.stringify(comp.prop_schema),
          field_types: JSON.stringify(comp.field_types),
        });
        logger.info(`[widget-api] Seeded component: ${comp.slug}`);
      }
    }

    // Seed themes
    const hasThemes = await db.schema.hasTable('widget_themes');
    if (hasThemes) {
      for (const theme of THEMES) {
        const existing = await db('widget_themes').where('slug', theme.slug).first('id');
        if (!existing) {
          await db('widget_themes').insert({
            ...theme,
            variables: JSON.stringify(theme.variables),
          });
          logger.info(`[widget-api] Seeded theme: ${theme.slug}`);
        }
      }
    }

    // Seed templates
    const hasTemplates = await db.schema.hasTable('widget_templates');
    if (hasTemplates) {
      for (const tmpl of TEMPLATES) {
        const existing = await db('widget_templates').where('slug', tmpl.slug).first('id');
        if (!existing) {
          await db('widget_templates').insert({
            ...tmpl,
            layout_skeleton: JSON.stringify(tmpl.layout_skeleton),
          });
          logger.info(`[widget-api] Seeded template: ${tmpl.slug}`);
        }
      }
    }

    logger.info('[widget-api] Seed complete');
  } catch (err) {
    logger.warn(`[widget-api] Seed failed (collections may not exist yet): ${(err as Error).message}`);
  }
}

export { COMPONENTS, THEMES, TEMPLATES };

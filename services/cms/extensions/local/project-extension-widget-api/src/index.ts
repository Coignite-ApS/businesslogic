import { defineHook } from '@directus/extensions-sdk';
import { seedWidgetData } from './seed.js';
import { generateAutoLayout } from './auto-layout.js';

export default defineHook(
  ({ init, action }, { env, logger, database }) => {
    const db = database;
    const formulaApiUrl = (env['FORMULA_API_URL'] as string || 'http://localhost:3000').replace(/\/+$/, '');
    const gatewayUrl = (env['GATEWAY_URL'] as string || '').replace(/\/+$/, '');
    const gatewayInternalSecret = env['GATEWAY_INTERNAL_SECRET'] as string || '';

    // Invalidate gateway widget cache on layout/theme/template changes
    const invalidateWidgetCache = async () => {
      if (!gatewayUrl || !gatewayInternalSecret) return;
      try {
        await fetch(`${gatewayUrl}/internal/cache/invalidate`, {
          method: 'POST',
          headers: { 'X-Internal-Secret': gatewayInternalSecret },
        });
        logger.info('[widget-api] gateway widget cache invalidated');
      } catch (err) {
        logger.warn(`[widget-api] cache invalidation failed: ${(err as Error).message}`);
      }
    };

    for (const collection of ['calculator_layouts', 'widget_themes', 'widget_templates', 'widget_components']) {
      action(`${collection}.items.create`, () => invalidateWidgetCache());
      action(`${collection}.items.update`, () => invalidateWidgetCache());
      action(`${collection}.items.delete`, () => invalidateWidgetCache());
    }

    // Seed widget data on startup
    init('app.after', async () => {
      await seedWidgetData(db, logger);
    });

    // Register widget API routes
    init('routes.custom.before', ({ app }) => {

      // GET /calc/widget-config/:calcId — merged layout config for a calculator
      app.get('/calc/widget-config/:calcId', async (req: any, res: any) => {
        try {
          const { calcId } = req.params;

          // Check for custom layout
          let layoutConfig = null;
          try {
            const hasLayouts = await db.schema.hasTable('calculator_layouts');
            if (hasLayouts) {
              const layout = await db('calculator_layouts')
                .where('calculator', calcId)
                .where('status', 'published')
                .orderBy('date_updated', 'desc')
                .first();
              if (layout) {
                layoutConfig = typeof layout.layout_config === 'string'
                  ? JSON.parse(layout.layout_config)
                  : layout.layout_config;
              }
            }
          } catch { /* table may not exist yet */ }

          // Fetch describe from formula-api
          const token = req.headers['x-auth-token'] || '';
          const describeRes = await fetch(
            `${formulaApiUrl}/calculator/${encodeURIComponent(calcId)}/describe`,
            { headers: token ? { 'X-Auth-Token': token } : {} },
          );

          if (!describeRes.ok) {
            return res.status(describeRes.status).json({
              errors: [{ message: `Calculator describe failed: ${describeRes.status}` }],
            });
          }

          const describe = await describeRes.json() as any;

          // Auto-generate layout if no custom config
          if (!layoutConfig) {
            layoutConfig = generateAutoLayout(
              describe.expected_input || { type: 'object', properties: {} },
              describe.expected_output || { type: 'object', properties: {} },
            );
          }

          // Resolve theme if specified
          let themeVariables: Record<string, string> | undefined;
          if (layoutConfig.theme) {
            try {
              const theme = await db('widget_themes')
                .where('slug', layoutConfig.theme)
                .where('status', 'published')
                .first();
              if (theme) {
                themeVariables = typeof theme.variables === 'string'
                  ? JSON.parse(theme.variables)
                  : theme.variables;
              }
            } catch { /* ignore */ }
          }

          return res.json({
            calculator_id: calcId,
            name: describe.name,
            description: describe.description,
            layout: layoutConfig,
            input_schema: describe.expected_input,
            output_schema: describe.expected_output,
            theme_variables: themeVariables,
          });
        } catch (err) {
          logger.error(`[widget-api] widget-config error: ${(err as Error).message}`);
          return res.status(502).json({ errors: [{ message: 'Widget config unavailable' }] });
        }
      });

      // GET /calc/widget-components — all published components
      app.get('/calc/widget-components', async (_req: any, res: any) => {
        try {
          const hasTable = await db.schema.hasTable('widget_components');
          if (!hasTable) return res.json({ data: [] });

          const components = await db('widget_components')
            .where('status', 'published')
            .orderBy('sort', 'asc');

          // Parse JSON fields
          const parsed = components.map((c: any) => ({
            ...c,
            default_props: typeof c.default_props === 'string' ? JSON.parse(c.default_props) : c.default_props,
            prop_schema: typeof c.prop_schema === 'string' ? JSON.parse(c.prop_schema) : c.prop_schema,
            field_types: typeof c.field_types === 'string' ? JSON.parse(c.field_types) : c.field_types,
          }));

          return res.json({ data: parsed });
        } catch (err) {
          logger.error(`[widget-api] widget-components error: ${(err as Error).message}`);
          return res.status(500).json({ errors: [{ message: 'Failed to fetch components' }] });
        }
      });

      // GET /calc/widget-themes — all published themes
      app.get('/calc/widget-themes', async (_req: any, res: any) => {
        try {
          const hasTable = await db.schema.hasTable('widget_themes');
          if (!hasTable) return res.json({ data: [] });

          const themes = await db('widget_themes')
            .where('status', 'published')
            .orderBy('sort', 'asc');

          const parsed = themes.map((t: any) => ({
            ...t,
            variables: typeof t.variables === 'string' ? JSON.parse(t.variables) : t.variables,
          }));

          return res.json({ data: parsed });
        } catch (err) {
          logger.error(`[widget-api] widget-themes error: ${(err as Error).message}`);
          return res.status(500).json({ errors: [{ message: 'Failed to fetch themes' }] });
        }
      });

      // GET /calc/widget-templates — all published layout templates
      app.get('/calc/widget-templates', async (_req: any, res: any) => {
        try {
          const hasTable = await db.schema.hasTable('widget_templates');
          if (!hasTable) return res.json({ data: [] });

          const templates = await db('widget_templates')
            .where('status', 'published')
            .orderBy('sort', 'asc');

          const parsed = templates.map((t: any) => ({
            ...t,
            layout_skeleton: typeof t.layout_skeleton === 'string' ? JSON.parse(t.layout_skeleton) : t.layout_skeleton,
          }));

          return res.json({ data: parsed });
        } catch (err) {
          logger.error(`[widget-api] widget-templates error: ${(err as Error).message}`);
          return res.status(500).json({ errors: [{ message: 'Failed to fetch templates' }] });
        }
      });
    });
  },
);

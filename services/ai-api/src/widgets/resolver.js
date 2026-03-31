import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../db.js';
import { applyMapping } from './mapping.js';
import {
  getCachedTemplate,
  setCachedTemplate,
  clearWidgetCache,
} from './cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Built-in templates loaded from JSON files (fallback when DB has no match)
let builtinTemplates = new Map();

/**
 * Load built-in templates from services/ai-api/src/widgets/templates/*.json.
 * Called once on startup. Returns the Map for testing.
 */
export function loadBuiltinTemplates() {
  builtinTemplates = new Map();
  const dir = join(__dirname, 'templates');
  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const tpl = JSON.parse(raw);
      if (tpl.tool_binding) {
        builtinTemplates.set(tpl.tool_binding, {
          id: `builtin:${tpl.tool_binding}`,
          name: tpl.name,
          description: tpl.description || null,
          tool_binding: tpl.tool_binding,
          resource_binding: null,
          template: typeof tpl.template === 'string' ? tpl.template : JSON.stringify(tpl.template),
          data_mapping: typeof tpl.data_mapping === 'string' ? tpl.data_mapping : JSON.stringify(tpl.data_mapping),
          status: 'published',
          sort: tpl.sort || 999,
        });
      }
    }
  } catch {
    // Templates dir missing — no built-ins available
  }
  return builtinTemplates;
}

/** Get a built-in template by tool name. */
export function getBuiltinTemplate(toolName) {
  return builtinTemplates.get(toolName) || null;
}

/**
 * Look up a widget template for a given tool call.
 * Resolution: Cache → DB specific → DB default → Built-in → null
 */
export async function findTemplate(toolName, resourceId = null) {
  // Check cache (undefined = miss, null = negative cache)
  const cached = await getCachedTemplate(toolName, resourceId);
  if (cached !== undefined) return cached;

  try {
    // Try specific match first
    if (resourceId) {
      const specific = await query(
        `SELECT * FROM bl_widget_templates
         WHERE tool_binding = $1 AND resource_binding = $2 AND status = 'published'
         ORDER BY sort ASC NULLS LAST LIMIT 1`,
        [toolName, resourceId]
      );
      if (specific.rows.length > 0) {
        await setCachedTemplate(toolName, resourceId, specific.rows[0]);
        return specific.rows[0];
      }
    }

    // Fall back to default (null resource_binding)
    const defaultTpl = await query(
      `SELECT * FROM bl_widget_templates
       WHERE tool_binding = $1 AND resource_binding IS NULL AND status = 'published'
       ORDER BY sort ASC NULLS LAST LIMIT 1`,
      [toolName]
    );

    if (defaultTpl.rows.length > 0) {
      const tpl = defaultTpl.rows[0];
      await setCachedTemplate(toolName, resourceId, tpl);
      return tpl;
    }
  } catch {
    // DB error — fall through to built-in
  }

  // Fall back to built-in template
  const builtin = getBuiltinTemplate(toolName);
  if (builtin) {
    await setCachedTemplate(toolName, resourceId, builtin);
    return builtin;
  }

  // Negative cache — no template exists
  await setCachedTemplate(toolName, resourceId, null);
  return null;
}

/** Parse a ChatKit template string into a component tree. */
function parseTemplate(templateStr) {
  try {
    return typeof templateStr === 'string' ? JSON.parse(templateStr) : templateStr;
  } catch {
    return null;
  }
}

/** Hydrate a template tree with mapped data. */
export function hydrateTemplate(tree, data) {
  if (!tree) return null;

  const result = { component: tree.component };

  if (tree.props) {
    result.props = {};
    for (const [key, value] of Object.entries(tree.props)) {
      result.props[key] = hydrateValue(value, data);
    }
  }

  if (tree.children) {
    result.children = [];
    for (const child of tree.children) {
      if (child.component === '__each' && child.props?.source) {
        const arr = data[child.props.source];
        if (Array.isArray(arr) && child.children?.[0]) {
          for (const item of arr) {
            const hydrated = hydrateTemplate(child.children[0], { ...data, ...item, _item: item });
            if (hydrated) result.children.push(hydrated);
          }
        }
      } else {
        const hydrated = hydrateTemplate(child, data);
        if (hydrated) result.children.push(hydrated);
      }
    }
  }

  return result;
}

function hydrateValue(value, data) {
  if (typeof value === 'string') {
    const fullMatch = value.match(/^\{\{(\w+(?:\.\w+)*)\}\}$/);
    if (fullMatch) {
      return getNestedValue(data, fullMatch[1]);
    }
    return value.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
      const val = getNestedValue(data, key);
      return val == null ? '' : String(val);
    });
  }
  if (Array.isArray(value)) {
    return value.map(v => hydrateValue(v, data));
  }
  if (typeof value === 'object' && value !== null) {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = hydrateValue(v, data);
    }
    return result;
  }
  return value;
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return undefined;
    return o?.[k];
  }, obj);
}

/**
 * Resolve a tool result into a ChatKit widget tree.
 */
export async function resolveWidget(toolName, toolResult, options = {}) {
  const template = await findTemplate(toolName, options.resourceId);
  if (!template) return null;

  try {
    const mapping = typeof template.data_mapping === 'string'
      ? JSON.parse(template.data_mapping)
      : template.data_mapping;

    const mappedData = applyMapping(mapping || {}, toolResult);

    const tree = parseTemplate(template.template);
    if (!tree) return null;

    return hydrateTemplate(tree, mappedData);
  } catch {
    return null;
  }
}

/** Clear template cache (for testing or webhook invalidation) */
export function clearTemplateCache() {
  clearWidgetCache();
}

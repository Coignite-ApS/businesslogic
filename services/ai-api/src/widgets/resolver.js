import { LRUCache } from 'lru-cache';
import { query } from '../db.js';
import { applyMapping } from './mapping.js';

// Template cache (5 min TTL, max 100 templates)
const templateCache = new LRUCache({
  max: 100,
  ttl: 5 * 60 * 1000,
});

/**
 * Look up a widget template for a given tool call.
 * Resolution order:
 * 1. Specific: tool_binding + resource_binding match
 * 2. Default: tool_binding match, resource_binding IS NULL
 * 3. No match: return null
 *
 * @param {string} toolName - Tool binding name (e.g., 'execute_calculator')
 * @param {string|null} resourceId - Specific resource UUID (e.g., calculator ID)
 * @returns {Promise<object|null>} Template row or null
 */
export async function findTemplate(toolName, resourceId = null) {
  const cacheKey = `${toolName}:${resourceId || 'default'}`;

  const cached = templateCache.get(cacheKey);
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
        templateCache.set(cacheKey, specific.rows[0]);
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

    const result = defaultTpl.rows.length > 0 ? defaultTpl.rows[0] : null;
    templateCache.set(cacheKey, result);
    return result;
  } catch (err) {
    // DB error — return null (fallback to raw display)
    console.error('[widget-resolver] template lookup error:', err.message);
    return null;
  }
}

/**
 * Parse a ChatKit template string into a component tree.
 * Templates are stored as JSON strings in the database.
 *
 * @param {string} templateStr - JSON string of ChatKit component tree
 * @returns {object|null} Parsed tree or null
 */
function parseTemplate(templateStr) {
  try {
    return JSON.parse(templateStr);
  } catch {
    console.error('[widget-resolver] failed to parse template');
    return null;
  }
}

/**
 * Hydrate a template tree with mapped data.
 * Walks the tree and replaces {{key}} placeholders in prop values.
 *
 * @param {object} tree - ChatKit component tree (template with placeholders)
 * @param {object} data - Mapped data from applyMapping
 * @returns {object} Hydrated tree
 */
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
      // Handle {{#each key}} loops
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

/**
 * Replace {{key}} placeholders in a value with data.
 */
function hydrateValue(value, data) {
  if (typeof value === 'string') {
    // Full replacement: "{{key}}" → data[key] (preserves type)
    const fullMatch = value.match(/^\{\{(\w+(?:\.\w+)*)\}\}$/);
    if (fullMatch) {
      return getNestedValue(data, fullMatch[1]);
    }
    // Partial replacement: "Hello {{name}}" → "Hello World"
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
 *
 * @param {string} toolName - Tool that was called
 * @param {object} toolResult - Raw result from tool execution
 * @param {object} [options] - Options
 * @param {string} [options.resourceId] - Specific resource ID for template matching
 * @returns {Promise<object|null>} ChatKit tree or null
 */
export async function resolveWidget(toolName, toolResult, options = {}) {
  const template = await findTemplate(toolName, options.resourceId);
  if (!template) return null;

  try {
    // 1. Apply data mapping
    const mapping = typeof template.data_mapping === 'string'
      ? JSON.parse(template.data_mapping)
      : template.data_mapping;

    const mappedData = applyMapping(mapping || {}, toolResult);

    // 2. Parse template
    const tree = parseTemplate(template.template);
    if (!tree) return null;

    // 3. Hydrate template with mapped data
    const hydrated = hydrateTemplate(tree, mappedData);

    return hydrated;
  } catch (err) {
    console.error('[widget-resolver] resolve error:', err.message);
    return null;
  }
}

/** Clear template cache (for testing or webhook invalidation) */
export function clearTemplateCache() {
  templateCache.clear();
}

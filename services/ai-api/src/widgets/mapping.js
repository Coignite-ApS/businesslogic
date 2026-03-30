import { applyPipes } from './formats.js';

/**
 * Resolve a single mapping expression against source data.
 *
 * Expressions:
 * - $.path.to.field — navigate object path
 * - 'literal' — static string
 * - $.array[*].field — iterate array (used in array mapping)
 * - $.value | pipe:arg — apply format pipe
 *
 * @param {string} expr - Mapping expression
 * @param {object} source - Source data (tool result)
 * @returns {unknown} Resolved value
 */
export function resolveExpression(expr, source) {
  if (expr == null) return null;
  const str = String(expr).trim();

  // Literal string: 'some text'
  if (str.startsWith("'") && str.endsWith("'")) {
    return str.slice(1, -1);
  }

  // Split off pipes: $.field | currency:USD
  const pipeIdx = str.indexOf(' | ');
  let pathPart = str;
  let pipePart = '';
  if (pipeIdx >= 0) {
    pathPart = str.slice(0, pipeIdx).trim();
    pipePart = str.slice(pipeIdx + 3).trim();
  }

  // Resolve JSONPath
  let value = resolvePath(pathPart, source);

  // Apply pipes
  if (pipePart) {
    value = applyPipes(value, pipePart);
  }

  return value;
}

/**
 * Navigate a JSONPath-like expression.
 * Supports: $.foo.bar, $.foo[0].bar, $.foo[*].bar (returns array)
 */
function resolvePath(path, source) {
  if (!path || !path.startsWith('$')) return path;

  const parts = path.slice(2) // remove "$."
    .split(/\.(?![^\[]*\])/) // split on dots not inside brackets
    .filter(Boolean);

  let current = source;

  for (const part of parts) {
    if (current == null) return null;

    // Array wildcard: field[*]
    if (part.endsWith('[*]')) {
      const key = part.slice(0, -3);
      current = key ? current[key] : current;
      if (!Array.isArray(current)) return null;
      // Return the array — further navigation handled by caller
      continue;
    }

    // Array index: field[0]
    const bracketMatch = part.match(/^(.+?)\[(\d+)\]$/);
    if (bracketMatch) {
      current = current[bracketMatch[1]];
      if (!Array.isArray(current)) return null;
      current = current[Number(bracketMatch[2])];
      continue;
    }

    // Simple key
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return null;
    current = current[part];
  }

  return current;
}

/**
 * Apply a complete data mapping to source data.
 *
 * Mapping can be:
 * - string expression: "$.field | pipe" → resolves to value
 * - object with { source, map } → array mapping
 * - plain object → recursive mapping
 * - array of objects → inline literal array mapping
 *
 * @param {object} mapping - Mapping definition
 * @param {object} source - Source data (tool result)
 * @returns {object} Mapped data
 */
export function applyMapping(mapping, source) {
  if (!mapping || !source) return {};

  const result = {};

  for (const [key, expr] of Object.entries(mapping)) {
    if (typeof expr === 'string') {
      // Simple expression
      result[key] = resolveExpression(expr, source);
    } else if (Array.isArray(expr)) {
      // Inline literal array: [{ "label": "'Foo'", "value": "$.x" }]
      result[key] = expr.map(item => {
        if (typeof item === 'object' && item !== null) {
          return applyMapping(item, source);
        }
        return item;
      });
    } else if (typeof expr === 'object' && expr !== null) {
      if (expr.source && expr.map) {
        // Array mapping: { source: "$.results[*]", map: { field: "$.expr" } }
        const arr = resolveExpression(expr.source, source);
        if (Array.isArray(arr)) {
          result[key] = arr.map(item => {
            const mapped = {};
            for (const [mk, mv] of Object.entries(expr.map)) {
              if (typeof mv === 'string') {
                mapped[mk] = resolveExpression(mv, item);
              } else {
                mapped[mk] = mv;
              }
            }
            return mapped;
          });
        } else {
          result[key] = [];
        }
      } else {
        // Nested object mapping
        result[key] = applyMapping(expr, source);
      }
    } else {
      result[key] = expr;
    }
  }

  return result;
}

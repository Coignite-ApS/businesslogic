/**
 * Shared helpers for integration types (MCP, Skill, Plugin).
 * Extracted from src/routes/mcp.js.
 */

/**
 * Resolve {{input.key}} and {{output.key}} references in a response template.
 *
 * @param {string} template - Raw template string with {{input.x}} / {{output.x}} tokens
 * @param {Record<string, unknown>} inputs - Actual input values passed to the calculation
 * @param {Record<string, unknown>} outputs - Actual output values returned by the calculation
 * @returns {string} Template with all resolvable references replaced by their values
 */
export function resolveResponseTemplate(template, inputs, outputs) {
  if (!template) return '';
  return template.replace(/\{\{(input|output)\.([^}]+)\}\}/g, (match, kind, key) => {
    const val = kind === 'input' ? inputs?.[key] : outputs?.[key];
    if (val === undefined || val === null) return match; // leave unresolved refs as-is
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  });
}

export function buildTypeHint(prop) {
  // Transform overrides base type hint
  if (prop.transform === 'date') return 'Date YYYY-MM-DD (e.g. 2025-06-15)';
  if (prop.transform === 'time') return 'Time HH:MM or HH:MM:SS (e.g. 14:30)';
  if (prop.transform === 'datetime') return 'Datetime YYYY-MM-DDTHH:MM:SS (e.g. 2025-06-15T14:30:00)';
  if (prop.transform === 'percentage') return 'Percentage (e.g. 15 for 15%)';

  // oneOf → pick from options
  if (prop.oneOf && prop.oneOf.length) {
    const example = prop.oneOf[0]?.const;
    const options = prop.oneOf.map(o =>
      o.title != null ? `${o.title} -> ${o.const}` : `${o.const}`
    ).join(', ');
    return `(e.g. ${example}) Select value: ${options}`;
  }

  // Base type hints
  if (prop.type === 'integer') return 'Whole number (e.g. -3, 2, 5)';
  if (prop.type === 'number') return 'Number (e.g. -1, 5, 6.5)';
  if (prop.type === 'boolean') return 'true or false';
  if (prop.type === 'string') return 'Text';
  return null;
}

export function buildPropertyDescription(prop) {
  const parts = [];

  if (prop.title) parts.push(prop.title);

  const hint = buildTypeHint(prop);
  if (hint) parts.push(hint);

  if (prop.minimum != null && prop.maximum != null) {
    parts.push(`between ${prop.minimum} and ${prop.maximum}`);
  } else if (prop.minimum != null) {
    parts.push(`min ${prop.minimum}`);
  } else if (prop.maximum != null) {
    parts.push(`max ${prop.maximum}`);
  }

  return parts.length ? parts.join('. ') : undefined;
}

export function cleanInputSchemaForTools(inputSchema) {
  const clean = JSON.parse(JSON.stringify(inputSchema));
  delete clean.order;
  const props = clean.properties || {};
  for (const [, prop] of Object.entries(props)) {
    // Build description before stripping
    const desc = buildPropertyDescription(prop);
    if (desc) prop.description = desc;

    // Convert oneOf to enum for LLM compatibility
    if (prop.oneOf && prop.oneOf.length) {
      prop.enum = prop.oneOf.map(o => o.const);
    }

    // Strip internal fields
    delete prop.mapping;
    delete prop.transform;
    delete prop.oneOf;
    delete prop.order;
    delete prop.title;
    delete prop.selection_mapping_id;
    delete prop.selection_mapping_title;
    if (typeof prop.required === 'boolean') delete prop.required;
  }
  return clean;
}

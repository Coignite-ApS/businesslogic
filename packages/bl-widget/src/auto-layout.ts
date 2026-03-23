import type { JsonSchema, LayoutConfig, LayoutNode, SchemaProperty } from './types.js';

/** Map a schema property to the best-fit input component type */
export function mapInputComponent(name: string, prop: SchemaProperty): LayoutNode {
  if (prop.type === 'boolean') {
    return { type: 'checkbox', field: name };
  }
  // Date fields (transform: 'date' or format: 'date')
  if (prop.transform === 'date' || prop.format === 'date') {
    return { type: 'date-picker', field: name };
  }
  // Enum/oneOf: radio-group for <=4 options, dropdown for more
  if (prop.oneOf || prop.enum) {
    const count = prop.oneOf?.length ?? prop.enum?.length ?? 0;
    return { type: count <= 4 ? 'radio-group' : 'dropdown', field: name };
  }
  // Number with min+max: slider
  if (prop.type === 'number' && prop.minimum != null && prop.maximum != null) {
    return { type: 'slider', field: name, props: { min: prop.minimum, max: prop.maximum, step: prop.step ?? 1 } };
  }
  if (prop.type === 'integer') {
    const node: LayoutNode = { type: 'number-stepper', field: name };
    const props: Record<string, unknown> = {};
    if (prop.minimum != null) props.min = prop.minimum;
    if (prop.maximum != null) props.max = prop.maximum;
    if (Object.keys(props).length) node.props = props;
    return node;
  }
  // Default: text-input for string and number
  return { type: 'text-input', field: name };
}

/** Map a schema property to the best-fit output component type */
export function mapOutputComponent(name: string, prop: SchemaProperty): LayoutNode {
  if (prop.type === 'array') {
    return { type: 'table', field: name };
  }
  if (prop.type === 'number' || prop.type === 'integer') {
    return { type: 'metric', field: name };
  }
  return { type: 'text', field: name };
}

/** Sort properties by 'order' field, then alphabetically */
function sortProperties(schema: JsonSchema): Array<[string, SchemaProperty]> {
  return Object.entries(schema.properties).sort(([aName, a], [bName, b]) => {
    const aOrder = a.order ?? 999;
    const bOrder = b.order ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return aName.localeCompare(bName);
  });
}

/** Generate a layout config from input/output JSON schemas */
export function generateLayout(
  inputSchema: JsonSchema,
  outputSchema: JsonSchema,
): LayoutConfig {
  const inputChildren = sortProperties(inputSchema).map(([name, prop]) =>
    mapInputComponent(name, prop),
  );

  const outputChildren = sortProperties(outputSchema).map(([name, prop]) =>
    mapOutputComponent(name, prop),
  );

  return {
    version: '1.0',
    layout: {
      type: 'root',
      children: [
        { type: 'section', slot: 'inputs', children: inputChildren },
        { type: 'section', slot: 'outputs', children: outputChildren },
      ],
    },
  };
}

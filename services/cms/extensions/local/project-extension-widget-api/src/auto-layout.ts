import type { JsonSchema, LayoutNode, SchemaProperty } from './types.js';

/** Map an input schema property to the best-fit component type */
export function mapInputComponent(name: string, prop: SchemaProperty): LayoutNode {
  if (prop.type === 'boolean') return { type: 'checkbox', field: name };
  if (prop.oneOf || prop.enum) return { type: 'dropdown', field: name };
  if (prop.type === 'integer') {
    const node: LayoutNode = { type: 'number-stepper', field: name };
    const props: Record<string, unknown> = {};
    if (prop.minimum != null) props.min = prop.minimum;
    if (prop.maximum != null) props.max = prop.maximum;
    if (Object.keys(props).length) node.props = props;
    return node;
  }
  return { type: 'text-input', field: name };
}

/** Map an output schema property to the best-fit component type */
export function mapOutputComponent(name: string, prop: SchemaProperty): LayoutNode {
  if (prop.type === 'number' || prop.type === 'integer') return { type: 'metric', field: name };
  return { type: 'text', field: name };
}

/** Sort properties by 'order' then alphabetically */
function sortProperties(schema: JsonSchema): Array<[string, SchemaProperty]> {
  return Object.entries(schema.properties).sort(([aName, a], [bName, b]) => {
    const aOrder = a.order ?? 999;
    const bOrder = b.order ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return aName.localeCompare(bName);
  });
}

/** Generate a layout config from input/output JSON schemas */
export function generateAutoLayout(inputSchema: JsonSchema, outputSchema: JsonSchema) {
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

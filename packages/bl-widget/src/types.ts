/** JSON Schema property from calculator describe endpoint */
export interface SchemaProperty {
  type: string;
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  oneOf?: Array<{ const: unknown; title: string }>;
  enum?: unknown[];
  items?: { type: string; properties?: Record<string, SchemaProperty> };
  order?: number;
  step?: number;
  transform?: string;
  format?: string;
}

/** JSON Schema object from describe */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, SchemaProperty>;
}

/** Layout config node */
export interface LayoutNode {
  type: string;
  field?: string;
  slot?: string;
  props?: Record<string, unknown>;
  children?: LayoutNode[];
}

/** Full layout config */
export interface LayoutConfig {
  version: string;
  theme?: string;
  template?: string;
  layout: LayoutNode;
}

/** Widget config returned by CMS API */
export interface WidgetConfig {
  calculator_id: string;
  name?: string;
  description?: string;
  layout: LayoutConfig;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
  theme_variables?: Record<string, string>;
}

/** Calculator describe response */
export interface DescribeResponse {
  name: string | null;
  version: string | null;
  description: string | null;
  expected_input: JsonSchema;
  expected_output: JsonSchema;
}

/** Component field metadata passed to each component */
export interface FieldMeta {
  name: string;
  schema: SchemaProperty;
  value?: unknown;
}

/** ChatKit component tree node format */
export interface ChatKitNode {
  component: string;
  props?: Record<string, unknown>;
  children?: ChatKitNode[];
}

/** Union type for renderer input */
export type RenderableNode = LayoutNode | ChatKitNode;

/** Prop definition for component registry metadata */
export interface PropDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  default?: unknown;
  description?: string;
  options?: Array<{ value: unknown; label: string }>;
}

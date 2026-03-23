export interface WidgetComponent {
  id?: string;
  slug: string;
  name: string;
  description: string;
  category: 'input' | 'output' | 'layout';
  icon: string;
  renderer_type: string;
  default_props: Record<string, unknown>;
  prop_schema: Record<string, unknown>;
  field_types: string[];
  supports_animation: boolean;
  lazy_load: boolean;
  sort: number;
  status: 'published' | 'draft';
  version: string;
}

export interface WidgetTheme {
  id?: string;
  name: string;
  slug: string;
  variables: Record<string, string>;
  status: 'published' | 'draft';
  sort: number;
}

export interface WidgetTemplate {
  id?: string;
  name: string;
  slug: string;
  description: string;
  layout_skeleton: Record<string, unknown>;
  status: 'published' | 'draft';
  sort: number;
}

export interface SchemaProperty {
  type: string;
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  oneOf?: Array<{ const: unknown; title: string }>;
  enum?: unknown[];
  order?: number;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, SchemaProperty>;
}

export interface LayoutNode {
  type: string;
  field?: string;
  slot?: string;
  props?: Record<string, unknown>;
  children?: LayoutNode[];
}

export type DB = any;

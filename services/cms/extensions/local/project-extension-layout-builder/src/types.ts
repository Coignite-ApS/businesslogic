export interface BuilderNode {
  id: string;
  type: string;
  tag: string;
  props: Record<string, unknown>;
  children: BuilderNode[];
  canHaveChildren: boolean;
}

export interface PaletteItem {
  type: string;
  tag: string;
  label: string;
  description: string;
  canHaveChildren: boolean;
}

export interface PropField {
  key: string;
  label: string;
  type: 'string' | 'select' | 'boolean' | 'number';
  placeholder?: string;
  options?: string[];
  default?: unknown;
}

export type ExportNode = {
  component: string;
  props: Record<string, unknown>;
  children?: ExportNode[];
};

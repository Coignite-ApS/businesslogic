/** Declarative action config for widget interactions */
export interface ActionConfig {
  type: string;
  payload?: Record<string, unknown>;
  handler?: 'server' | 'client';
}

/** Custom event dispatched by interactive components */
export class BlActionEvent extends CustomEvent<ActionConfig> {
  constructor(action: ActionConfig) {
    super('bl-action', { detail: action, bubbles: true, composed: true });
  }
}

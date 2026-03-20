/**
 * Flow-based tool execution — wraps AI tool calls in micro-flows for
 * budget tracking, error handling, and audit trail.
 * Enabled when FLOW_TOOL_EXECUTION=true.
 */

import { config } from '../config.js';

/**
 * Execute a tool via the flow engine.
 * Falls back to direct execution if flow is unavailable.
 * @param {string} toolName
 * @param {object} toolInput
 * @param {string} accountId
 * @param {object} [logger]
 * @returns {Promise<{result: any, flowExecutionId?: string, viaFlow: boolean}>}
 */
export async function executeToolViaFlow(toolName, toolInput, accountId, logger = console) {
  if (!isFlowToolEnabled()) {
    return { viaFlow: false };
  }

  const url = `${config.flowTriggerUrl}/webhook/${config.flowToolFlowId}`;

  const headers = { 'Content-Type': 'application/json' };
  if (config.flowAdminToken) {
    headers['Authorization'] = `Bearer ${config.flowAdminToken}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tool_name: toolName,
        tool_input: toolInput,
        account_id: accountId,
        callback_url: `http://localhost:${config.port}/v1/ai/internal/tool-execute`,
      }),
      signal: AbortSignal.timeout(config.flowToolTimeoutMs || 30000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn?.(`Flow tool execution failed (${response.status}), falling back: ${text}`);
      return { viaFlow: false };
    }

    const data = await response.json().catch(() => ({}));

    // If flow returned the result synchronously
    if (data.result !== undefined) {
      return {
        result: data.result,
        flowExecutionId: data.execution_id,
        viaFlow: true,
      };
    }

    // If async (flow queued), fall back to direct execution
    return {
      flowExecutionId: data.execution_id,
      viaFlow: false,
    };
  } catch (err) {
    logger.warn?.(`Flow tool execution error, falling back: ${err.message}`);
    return { viaFlow: false };
  }
}

/**
 * Check if flow-based tool execution is enabled and configured.
 */
export function isFlowToolEnabled() {
  return config.flowToolExecution && !!config.flowTriggerUrl && !!config.flowToolFlowId;
}

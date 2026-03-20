/**
 * Flow-based KB ingestion — triggers the flow engine instead of BullMQ.
 * Enabled when FLOW_KB_INGEST=true. Falls back to BullMQ otherwise.
 */

import { config } from '../config.js';

/**
 * Trigger KB ingestion via the flow engine webhook.
 * @param {{documentId: string, kbId: string, accountId: string, fileId: string, reindex?: boolean}} jobData
 * @param {object} [logger] - Optional logger
 * @returns {Promise<{triggered: boolean, executionId?: string, error?: string}>}
 */
export async function triggerFlowIngest(jobData, logger = console) {
  if (!config.flowKbIngest) {
    return { triggered: false, error: 'flow_kb_ingest not enabled' };
  }

  if (!config.flowTriggerUrl || !config.flowIngestFlowId) {
    return { triggered: false, error: 'FLOW_TRIGGER_URL or FLOW_INGEST_FLOW_ID not configured' };
  }

  const url = `${config.flowTriggerUrl}/webhook/${config.flowIngestFlowId}`;

  const headers = {
    'Content-Type': 'application/json',
  };
  if (config.flowAdminToken) {
    headers['Authorization'] = `Bearer ${config.flowAdminToken}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        document_id: jobData.documentId,
        knowledge_base_id: jobData.kbId,
        account_id: jobData.accountId,
        file_id: jobData.fileId,
        reindex: jobData.reindex || false,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.error?.(`Flow ingest trigger failed: ${response.status} ${text}`);
      return { triggered: false, error: `HTTP ${response.status}: ${text}` };
    }

    const result = await response.json().catch(() => ({}));
    logger.info?.(`Flow ingest triggered for doc ${jobData.documentId}: execution ${result.execution_id || 'unknown'}`);

    return {
      triggered: true,
      executionId: result.execution_id,
    };
  } catch (err) {
    logger.error?.(`Flow ingest trigger error: ${err.message}`);
    return { triggered: false, error: err.message };
  }
}

/**
 * Check if flow-based ingestion is enabled and configured.
 * @returns {boolean}
 */
export function isFlowIngestEnabled() {
  return config.flowKbIngest && !!config.flowTriggerUrl && !!config.flowIngestFlowId;
}

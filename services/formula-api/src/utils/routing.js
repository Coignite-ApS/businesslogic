import { config } from '../config.js';
import { isSelf, getOwner } from '../services/hash-ring.js';
import { proxyRequest } from '../services/proxy.js';

// Routing preHandler for calculator routes.
// Extracts calculator ID from params or body, checks hash ring,
// proxies to owning instance if not self.
export function routeByCalcId(idSource = 'params') {
  return async function routeToOwner(req, reply) {
    // Skip if routing not enabled
    if (!config.internalUrl) return;

    // Skip if already routed (loop prevention)
    if (req.headers['x-routed-by']) return;

    const calcId = idSource === 'body'
      ? req.body?.calculatorId
      : req.params?.id;

    if (!calcId) return;

    if (isSelf(calcId)) return;

    const owner = getOwner(calcId);
    if (!owner?.internalUrl) return;

    try {
      const result = await proxyRequest(req, owner.internalUrl);
      for (const [k, v] of Object.entries(result.headers)) {
        reply.header(k, v);
      }
      return reply.code(result.status).send(result.body);
    } catch {
      // Proxy failed (owner dead?) — handle locally as fallback
      return;
    }
  };
}

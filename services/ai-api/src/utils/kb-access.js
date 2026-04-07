/**
 * KB-level access control for API key scoping.
 *
 * Reads from req.permissionsRaw (full gateway v3 structure).
 * services.kb.resources semantics:
 *   missing/null/["*"] → null (unrestricted, all KBs)
 *   ["uuid1","uuid2"]  → only those KBs
 *   []                 → no KB access
 */

/**
 * Extract allowed KB IDs from request permissions.
 * @returns {string[]|null} Array of allowed KB UUIDs, or null if unrestricted.
 */
export function getAllowedKbIds(req) {
  const kbPerm = req.permissionsRaw?.services?.kb;
  if (!kbPerm || kbPerm.enabled === false) return null;

  const resources = kbPerm.resources;
  if (!resources || !Array.isArray(resources)) return null;
  if (resources.includes('*')) return null;
  return resources;
}

/**
 * Assert the request has access to a specific KB.
 * Throws { statusCode: 403, message } if denied.
 */
export function assertKbAccess(req, kbId) {
  const allowed = getAllowedKbIds(req);
  if (allowed !== null && !allowed.includes(kbId)) {
    throw { statusCode: 403, message: 'API key does not have access to this knowledge base' };
  }
}

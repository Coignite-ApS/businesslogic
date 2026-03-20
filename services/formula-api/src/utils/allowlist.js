import net from 'node:net';

/**
 * Compile an array of IPs/CIDRs into a net.BlockList for fast lookup.
 * Returns null if input is empty/null.
 * Throws on invalid entries.
 */
export function compileIpAllowlist(ips) {
  if (!ips || !ips.length) return null;
  const bl = new net.BlockList();
  for (const entry of ips) {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(`Invalid IP entry: ${entry}`);
    }
    const trimmed = entry.trim();
    if (trimmed.includes('/')) {
      const [addr, prefix] = trimmed.split('/');
      const bits = parseInt(prefix, 10);
      if (isNaN(bits)) throw new Error(`Invalid CIDR: ${trimmed}`);
      const type = addr.includes(':') ? 'ipv6' : 'ipv4';
      try {
        bl.addSubnet(addr, bits, type);
      } catch (e) {
        throw new Error(`Invalid CIDR: ${trimmed}`);
      }
    } else {
      const type = trimmed.includes(':') ? 'ipv6' : 'ipv4';
      try {
        bl.addAddress(trimmed, type);
      } catch (e) {
        throw new Error(`Invalid IP: ${trimmed}`);
      }
    }
  }
  return bl;
}

/**
 * Validate an array of origin strings.
 * Returns normalized array or null if empty.
 * Throws on invalid entries.
 */
export function validateOrigins(origins) {
  if (!origins || !origins.length) return null;
  const result = [];
  for (const o of origins) {
    if (typeof o !== 'string' || !o.trim()) {
      throw new Error(`Invalid origin: ${o}`);
    }
    const trimmed = o.trim().toLowerCase();
    // Wildcard subdomain pattern: https://*.example.com
    if (trimmed.includes('*')) {
      if (!/^https?:\/\/\*\.[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d+)?$/.test(trimmed)) {
        throw new Error(`Invalid wildcard origin: ${o}`);
      }
    } else {
      try {
        new URL(trimmed);
      } catch {
        throw new Error(`Invalid origin: ${o}`);
      }
      // Must be scheme + host (+ optional port), no path
      if (!/^https?:\/\/[^/]+(:\d+)?$/.test(trimmed)) {
        throw new Error(`Invalid origin (must be scheme://host[:port]): ${o}`);
      }
    }
    result.push(trimmed);
  }
  return result;
}

/**
 * Check if an origin matches an allowedOrigins list.
 */
export function checkOrigin(allowedOrigins, origin) {
  if (!allowedOrigins || !allowedOrigins.length || !origin) return false;
  const lower = origin.toLowerCase();
  for (const allowed of allowedOrigins) {
    if (allowed.includes('*')) {
      // https://*.example.com → match single subdomain level
      const suffix = allowed.replace('*', '');  // "https://.example.com"
      const scheme = allowed.split('://')[0] + '://';
      if (!lower.startsWith(scheme)) continue;
      const host = lower.slice(scheme.length);
      const expectedSuffix = suffix.slice(scheme.length); // ".example.com" or ".example.com:port"
      if (host.endsWith(expectedSuffix) && !host.slice(0, -expectedSuffix.length).includes('.')) {
        return true;
      }
    } else {
      if (lower === allowed) return true;
    }
  }
  return false;
}

/**
 * Check if a request passes the allowlist.
 * Both empty = allow all. Either match = allowed.
 */
export function checkAllowlist(ipBlocklist, allowedOrigins, ip, origin) {
  const hasIpList = !!ipBlocklist;
  const hasOriginList = allowedOrigins && allowedOrigins.length > 0;
  if (!hasIpList && !hasOriginList) return true;

  if (hasIpList && ip) {
    try {
      if (ipBlocklist.check(ip)) return true;
    } catch { /* invalid IP format, skip */ }
  }

  if (hasOriginList && origin) {
    if (checkOrigin(allowedOrigins, origin)) return true;
  }

  return false;
}

/**
 * Extract client IP from request. Prefers CF-Connecting-IP (Cloudflare), falls back to req.ip.
 */
export function getClientIp(req) {
  return req.headers['cf-connecting-ip'] || req.ip;
}

/**
 * Set CORS headers if origin matches allowedOrigins.
 */
export function setCorsHeaders(reply, origin, allowedOrigins) {
  if (!origin || !allowedOrigins || !allowedOrigins.length) return;
  if (checkOrigin(allowedOrigins, origin)) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Vary', 'Origin');
  }
}

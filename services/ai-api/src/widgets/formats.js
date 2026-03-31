/**
 * Format pipes for widget data mapping.
 * Each pipe takes a value and optional arg, returns formatted value.
 */

const pipes = {
  /** Format as currency: 1234.5 | currency:USD → "$1,234.50" */
  currency(value, code = 'USD') {
    if (value == null) return null;
    const num = Number(value);
    if (isNaN(num)) return String(value);
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(num);
    } catch {
      return `${num.toFixed(2)} ${code}`;
    }
  },

  /** Format as percentage: 0.85 | percent → "85%" */
  percent(value) {
    if (value == null) return null;
    const num = Number(value);
    if (isNaN(num)) return String(value);
    return `${Math.round(num * 100)}%`;
  },

  /** Truncate string: "long text..." | truncate:20 → "long text…" */
  truncate(value, maxLen = 100) {
    if (value == null) return null;
    const str = String(value);
    const n = Number(maxLen);
    if (str.length <= n) return str;
    return str.slice(0, n) + '…';
  },

  /** Force to string */
  string(value) {
    if (value == null) return '';
    return String(value);
  },

  /** Default value if null/undefined */
  default(value, defaultVal = '') {
    return value ?? defaultVal;
  },

  /** Concat suffix: 5 | concat: items → "5 items" */
  concat(value, suffix = '') {
    if (value == null) return null;
    return `${value} ${suffix}`.trim();
  },

  /** Convert object to entries array: {a:1,b:2} | entries → [{key:"a",value:1},...] */
  entries(value) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.entries(value).map(([key, val]) => ({ key, value: val }));
  },
};

/**
 * Apply a pipe chain to a value.
 * @param {unknown} value - Input value
 * @param {string} pipeStr - Pipe expression like "currency:USD" or "string | concat: items"
 * @returns {unknown}
 */
export function applyPipes(value, pipeStr) {
  if (!pipeStr) return value;
  const parts = pipeStr.split('|').map(s => s.trim());
  let result = value;
  for (const part of parts) {
    const [name, ...argParts] = part.split(':');
    const pipeFn = pipes[name.trim()];
    if (!pipeFn) continue;
    const arg = argParts.join(':').trim() || undefined;
    result = pipeFn(result, arg);
  }
  return result;
}

export { pipes };

const HTML_TAG_RE = /<\/?[^>]+(>|$)/g;

export function stripHtml(str) {
  return str.replace(HTML_TAG_RE, '');
}

export function sanitizeMessage(message, maxLength) {
  if (!message || typeof message !== 'string') return '';
  let clean = stripHtml(message);
  if (clean.length > maxLength) clean = clean.slice(0, maxLength);
  return clean;
}

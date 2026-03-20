import { config } from '../config.js';

const FORWARD_HEADERS = [
  'content-type', 'x-auth-token', 'x-admin-token',
  'origin', 'cf-connecting-ip', 'x-forwarded-for',
  'x-forwarded-host', 'x-forwarded-proto', 'accept',
];

const COPY_RESPONSE_HEADERS = [
  'content-type', 'x-cache', 'retry-after',
  'access-control-allow-origin', 'access-control-allow-headers',
  'access-control-allow-methods', 'vary',
];

export async function proxyRequest(req, targetUrl) {
  const url = `${targetUrl}${req.url}`;

  const headers = { 'x-routed-by': config.instanceId };
  for (const name of FORWARD_HEADERS) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }

  const opts = {
    method: req.method,
    headers,
    signal: AbortSignal.timeout(config.requestTimeout),
  };

  // Forward body for POST/PATCH/PUT
  if (req.body !== undefined && req.body !== null && ['POST', 'PATCH', 'PUT'].includes(req.method)) {
    opts.body = JSON.stringify(req.body);
  }

  const res = await fetch(url, opts);

  // Collect response headers to copy
  const responseHeaders = {};
  for (const name of COPY_RESPONSE_HEADERS) {
    const val = res.headers.get(name);
    if (val) responseHeaders[name] = val;
  }

  // Read body as buffer to support both JSON and binary (xlsx)
  const body = Buffer.from(await res.arrayBuffer());

  return { status: res.status, headers: responseHeaders, body };
}

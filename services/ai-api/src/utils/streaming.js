/**
 * SSE streaming helpers for Server-Sent Events responses.
 */

/** Write an SSE event to a raw http.ServerResponse */
export function sendSSE(res, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  res.raw.write(payload);
  if (typeof res.raw.flush === 'function') res.raw.flush();
}

/** Set SSE headers on a Fastify reply */
export function setSSEHeaders(reply) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

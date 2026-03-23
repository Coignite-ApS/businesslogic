/**
 * Feature-flagged proxy to bl-ai-api via gateway internal route.
 * When GATEWAY_URL is set and AI_SERVICE_ENABLED=true, forwards requests
 * through gateway /internal/ai/ with X-Internal-Secret auth.
 * On any error, returns false to fall through to local Directus handling.
 */

interface ProxyEnv {
	AI_SERVICE_ENABLED?: string;
	GATEWAY_URL?: string;
	GATEWAY_INTERNAL_SECRET?: string;
}

export async function proxyToAiApi(
	req: any,
	res: any,
	env: ProxyEnv,
	logger: any,
): Promise<boolean> {
	if (env.AI_SERVICE_ENABLED !== 'true' || !env.GATEWAY_URL) {
		return false;
	}

	const gwUrl = env.GATEWAY_URL.replace(/\/+$/, '');
	const targetUrl = `${gwUrl}/internal/ai/v1/ai${req.path}`;

	try {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		if (env.GATEWAY_INTERNAL_SECRET) {
			headers['X-Internal-Secret'] = env.GATEWAY_INTERNAL_SECRET;
		}

		if (req.accountability?.user) {
			headers['X-User-Id'] = req.accountability.user;
		}

		// Resolve account ID from accountability
		if (req.accountability?.role) {
			headers['X-Account-Role'] = req.accountability.role;
		}

		// Forward auth header
		if (req.headers?.authorization) {
			headers['Authorization'] = req.headers.authorization;
		}

		// Forward account header if present
		if (req.headers?.['x-account-id']) {
			headers['X-Account-Id'] = req.headers['x-account-id'];
		}

		const fetchOpts: RequestInit = {
			method: req.method,
			headers,
		};

		if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
			fetchOpts.body = JSON.stringify(req.body);
		}

		const upstream = await fetch(targetUrl, fetchOpts);

		// SSE streaming response (chat endpoint)
		const contentType = upstream.headers.get('content-type') || '';
		if (contentType.includes('text/event-stream') && upstream.body) {
			res.writeHead(upstream.status, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
				'X-Accel-Buffering': 'no',
			});

			const reader = (upstream.body as any).getReader();
			const decoder = new TextDecoder();

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					res.write(decoder.decode(value, { stream: true }));
					if (typeof res.flush === 'function') res.flush();
				}
			} catch {
				// Client disconnected or stream error — acceptable
			} finally {
				res.end();
			}

			return true;
		}

		// JSON response
		const body = await upstream.text();
		res.status(upstream.status);
		res.set('Content-Type', contentType || 'application/json');
		res.send(body);
		return true;
	} catch (err: any) {
		logger.warn(`AI proxy failed (${targetUrl}): ${err.message} — falling back to local`);
		return false;
	}
}

/**
 * Feature-flagged proxy to bl-ai-api service.
 * When AI_SERVICE_ENABLED=true, forwards requests to the standalone AI API.
 * On any error, returns false to fall through to local Directus handling.
 */

interface ProxyEnv {
	AI_SERVICE_ENABLED?: string;
	AI_SERVICE_URL?: string;
	AI_API_ADMIN_TOKEN?: string;
}

export async function proxyToAiApi(
	req: any,
	res: any,
	env: ProxyEnv,
	logger: any,
): Promise<boolean> {
	if (env.AI_SERVICE_ENABLED !== 'true' || !env.AI_SERVICE_URL) {
		return false;
	}

	const baseUrl = env.AI_SERVICE_URL.replace(/\/+$/, '');
	const targetUrl = `${baseUrl}/v1/ai${req.path}`;

	try {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		if (env.AI_API_ADMIN_TOKEN) {
			headers['X-Admin-Token'] = env.AI_API_ADMIN_TOKEN;
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

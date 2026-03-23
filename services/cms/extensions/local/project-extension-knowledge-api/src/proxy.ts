/**
 * Feature-flagged proxy to bl-ai-api KB endpoints via gateway internal route.
 * When GATEWAY_URL is set and AI_SERVICE_ENABLED=true, forwards KB requests
 * through gateway /internal/ai/ with X-Internal-Secret auth.
 * On any error, returns false to fall through to local Directus handling.
 */

interface ProxyEnv {
	AI_SERVICE_ENABLED?: string;
	GATEWAY_URL?: string;
	GATEWAY_INTERNAL_SECRET?: string;
}

export async function proxyToKbApi(
	req: any,
	res: any,
	env: ProxyEnv,
	logger: any,
): Promise<boolean> {
	if (env.AI_SERVICE_ENABLED !== 'true' || !env.GATEWAY_URL) {
		return false;
	}

	const gwUrl = env.GATEWAY_URL.replace(/\/+$/, '');
	// Map /kb/* paths to /v1/ai/kb/* via gateway internal route
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

		// JSON response (KB endpoints don't use SSE)
		const contentType = upstream.headers.get('content-type') || '';
		const body = await upstream.text();
		res.status(upstream.status);
		res.set('Content-Type', contentType || 'application/json');
		res.send(body);
		return true;
	} catch (err: any) {
		logger.warn(`KB proxy failed (${targetUrl}): ${err.message} — falling back to local`);
		return false;
	}
}

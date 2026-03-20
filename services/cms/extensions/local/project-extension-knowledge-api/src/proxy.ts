/**
 * Feature-flagged proxy to bl-ai-api KB endpoints.
 * When AI_SERVICE_ENABLED=true, forwards KB requests to the standalone AI API.
 * On any error, returns false to fall through to local Directus handling.
 */

interface ProxyEnv {
	AI_SERVICE_ENABLED?: string;
	AI_SERVICE_URL?: string;
	AI_API_ADMIN_TOKEN?: string;
}

export async function proxyToKbApi(
	req: any,
	res: any,
	env: ProxyEnv,
	logger: any,
): Promise<boolean> {
	if (env.AI_SERVICE_ENABLED !== 'true' || !env.AI_SERVICE_URL) {
		return false;
	}

	const baseUrl = env.AI_SERVICE_URL.replace(/\/+$/, '');
	// Map /kb/* paths to /v1/ai/kb/*
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

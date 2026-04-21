/**
 * Directus HTTP helper.
 *
 * Wraps fetch() against the local dev Directus instance (port 18055).
 * Uses static bearer tokens from directus_users.token.
 */

const DIRECTUS_URL = process.env.TEST_DIRECTUS_URL ?? 'http://localhost:18055';

export interface DirectusResponse<T = any> {
	status: number;
	ok: boolean;
	data?: T;
	error?: any;
}

/** GET /items/<collection> with optional query parameters. */
export async function getItems<T = any>(
	token: string,
	collection: string,
	query: Record<string, string> = {},
): Promise<DirectusResponse<T[]>> {
	const params = new URLSearchParams(query);
	const url = `${DIRECTUS_URL}/items/${collection}${params.toString() ? `?${params}` : ''}`;
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${token}` },
	});
	const json = await res.json().catch(() => ({}));
	return {
		status: res.status,
		ok: res.ok,
		data: (json as any).data,
		error: (json as any).errors,
	};
}

/** PATCH /items/<collection>/<id> */
export async function patchItem(
	token: string,
	collection: string,
	id: string,
	body: Record<string, any>,
): Promise<DirectusResponse> {
	const res = await fetch(`${DIRECTUS_URL}/items/${collection}/${id}`, {
		method: 'PATCH',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});
	const json = await res.json().catch(() => ({}));
	return {
		status: res.status,
		ok: res.ok,
		data: (json as any).data,
		error: (json as any).errors,
	};
}

/** DELETE /items/<collection>/<id> */
export async function deleteItem(
	token: string,
	collection: string,
	id: string,
): Promise<DirectusResponse> {
	const res = await fetch(`${DIRECTUS_URL}/items/${collection}/${id}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${token}` },
	});
	// DELETE typically returns 204 No Content with empty body
	let json: any = {};
	if (res.status !== 204) {
		json = await res.json().catch(() => ({}));
	}
	return {
		status: res.status,
		ok: res.ok,
		data: json.data,
		error: json.errors,
	};
}

/** Check whether Directus is reachable. Used in test gate. */
export async function directusReachable(): Promise<boolean> {
	try {
		const res = await fetch(`${DIRECTUS_URL}/server/ping`, {
			signal: AbortSignal.timeout(2000),
		});
		return res.ok || res.status === 200;
	} catch {
		return false;
	}
}

export { DIRECTUS_URL };

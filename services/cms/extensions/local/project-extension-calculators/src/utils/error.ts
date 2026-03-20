export function extractErrorMessage(err: any, fallback: string): string {
	const data = err?.response?.data;

	// Structured 422 OUTPUT_ERROR with per-field details
	if (data?.code === 'OUTPUT_ERROR' && Array.isArray(data?.fields)) {
		const fieldErrors = data.fields.map((f: any) => `${f.field}: ${f.error?.message || 'error'}`).join('; ');
		return `${data.error || 'Calculation error'} — ${fieldErrors}`;
	}

	// 400 validation errors with details array
	if (Array.isArray(data?.details)) {
		return data.details.map((d: any) => d.message || d).join('; ');
	}

	if (data?.errors?.[0]?.message) return data.errors[0].message;
	if (data?.detail) return data.error ? `${data.error}: ${data.detail}` : data.detail;
	if (err?.message && !err.message.startsWith('Request failed')) return err.message;
	return fallback;
}

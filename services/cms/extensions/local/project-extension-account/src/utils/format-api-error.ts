// Duplicated in: project-extension-ai-assistant/src/utils/format-api-error.ts
// Keep in sync — no cross-extension imports (each extension builds independently).

export function formatApiError(err: unknown): string {
	const error = err as {
		response?: {
			status?: number;
			data?: { errors?: Array<{ message?: string }> };
		};
		message?: string;
	};

	const serverMessage = error?.response?.data?.errors?.[0]?.message;
	if (serverMessage) return serverMessage;

	const status = error?.response?.status;
	switch (status) {
		case 401: return 'Your session expired. Please log in again.';
		case 403: return "You don't have permission to view this. Contact your account admin.";
		case 404: return 'Not found — this page or data may have been removed.';
		case 500: return 'Something broke on our side. The team has been notified.';
		case 502:
		case 503:
		case 504: return 'Service temporarily unavailable. Try again in a moment.';
		default: return error?.message || 'An unexpected error occurred.';
	}
}

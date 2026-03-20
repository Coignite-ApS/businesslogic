/** Input sanitization middleware for AI chat */

const HTML_TAG_RE = /<\/?[^>]+(>|$)/g;

/** Strip HTML tags from a string */
function stripHtml(str: string): string {
	return str.replace(HTML_TAG_RE, '');
}

export function createSanitizeMiddleware(maxMessageLength: number) {
	return (req: any, _res: any, next: () => void) => {
		if (req.body?.message && typeof req.body.message === 'string') {
			// Strip HTML tags
			req.body.message = stripHtml(req.body.message);

			// Truncate to max length
			if (req.body.message.length > maxMessageLength) {
				req.body.message = req.body.message.slice(0, maxMessageLength);
			}
		}
		next();
	};
}

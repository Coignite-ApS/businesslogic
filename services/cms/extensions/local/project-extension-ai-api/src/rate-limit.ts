/** In-memory sliding window rate limiter (per-user) */

interface RateLimitEntry {
	timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of store) {
		entry.timestamps = entry.timestamps.filter(t => now - t < 120_000);
		if (entry.timestamps.length === 0) store.delete(key);
	}
}, 300_000);

export function createRateLimitMiddleware(limitPerMinute: number) {
	return (req: any, res: any, next: () => void) => {
		const userId = req.accountability?.user;
		if (!userId) return next(); // auth middleware handles this

		// Admins bypass rate limit
		if (req.accountability.admin) return next();

		const key = `ai:${userId}`;
		const now = Date.now();
		const windowMs = 60_000;

		let entry = store.get(key);
		if (!entry) {
			entry = { timestamps: [] };
			store.set(key, entry);
		}

		// Remove timestamps outside the window
		entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);

		if (entry.timestamps.length >= limitPerMinute) {
			const oldest = entry.timestamps[0];
			const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
			res.setHeader('Retry-After', String(retryAfter));
			return res.status(429).json({
				errors: [{ message: `Rate limit exceeded. Try again in ${retryAfter}s.` }],
				retry_after: retryAfter,
			});
		}

		entry.timestamps.push(now);
		next();
	};
}

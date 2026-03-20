import { createHash } from 'node:crypto';
import Redis from 'ioredis';

export class KbCache {
	private redis: Redis;
	private ttl: number;

	constructor(redisUrl: string, ttl: number = 3600) {
		this.redis = new Redis(redisUrl);
		this.ttl = ttl;
	}

	private buildKey(query: string, chunkIds: string[]): string {
		const sorted = [...chunkIds].sort();
		const hash = createHash('sha256')
			.update(query + '|' + sorted.join(','))
			.digest('hex');
		return `kb:answer:${hash}`;
	}

	async get(query: string, chunkIds: string[]): Promise<any | null> {
		try {
			const key = this.buildKey(query, chunkIds);
			const cached = await this.redis.get(key);
			if (cached) return JSON.parse(cached);
			return null;
		} catch {
			return null;
		}
	}

	async set(query: string, chunkIds: string[], data: any): Promise<void> {
		try {
			const key = this.buildKey(query, chunkIds);
			await this.redis.setex(key, this.ttl, JSON.stringify(data));
		} catch {
			// Cache write failure is non-critical
		}
	}

	/** Invalidate all cached answers for a knowledge base */
	async bustKbCache(kbId: string): Promise<void> {
		try {
			// Use SCAN to find and delete matching keys
			let cursor = '0';
			do {
				const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'kb:answer:*', 'COUNT', 100);
				cursor = nextCursor;
				if (keys.length > 0) {
					await this.redis.del(...keys);
				}
			} while (cursor !== '0');
		} catch {
			// Non-critical
		}
	}

	async disconnect(): Promise<void> {
		try {
			await this.redis.quit();
		} catch {
			// ignore
		}
	}
}

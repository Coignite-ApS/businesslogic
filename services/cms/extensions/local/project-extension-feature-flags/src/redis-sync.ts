import Redis from 'ioredis';

export class FeatureFlagCache {
	private client: Redis;
	private ready = false;

	constructor(redisUrl: string, private logger: any) {
		this.client = new Redis(redisUrl, { lazyConnect: true, enableOfflineQueue: false });

		this.client.on('ready', () => {
			this.ready = true;
			logger.info('[feature-flags] Redis connected');
		});

		this.client.on('error', (err: Error) => {
			this.ready = false;
			logger.warn(`[feature-flags] Redis error: ${err.message}`);
		});

		this.client.connect().catch((err: Error) => {
			logger.warn(`[feature-flags] Redis connect failed: ${err.message}`);
		});
	}

	private get ok(): boolean {
		return this.ready;
	}

	/** Full sync: all platform flags + all account overrides */
	async fullSync(db: any): Promise<void> {
		if (!this.ok) return;

		try {
			const features = await db('platform_features').select('key', 'enabled');

			const pipeline = this.client.pipeline();

			// Clear old keys set
			pipeline.del('cms:features:_keys');

			for (const f of features) {
				pipeline.set(`cms:features:${f.key}`, f.enabled ? '1' : '0');
				pipeline.sadd('cms:features:_keys', f.key);
			}

			// Account overrides
			const overrides = await db('account_features')
				.join('platform_features', 'account_features.feature', 'platform_features.id')
				.select('account_features.account', 'platform_features.key', 'account_features.enabled');

			for (const o of overrides) {
				pipeline.set(`cms:features:${o.account}:${o.key}`, o.enabled ? '1' : '0');
			}

			await pipeline.exec();
			this.logger.info(`[feature-flags] Redis full sync: ${features.length} features, ${overrides.length} overrides`);
		} catch (err: any) {
			this.logger.warn(`[feature-flags] Redis full sync failed: ${err.message}`);
		}
	}

	async setPlatformFlag(key: string, enabled: boolean): Promise<void> {
		if (!this.ok) return;
		try {
			await this.client.pipeline()
				.set(`cms:features:${key}`, enabled ? '1' : '0')
				.sadd('cms:features:_keys', key)
				.exec();
		} catch (err: any) {
			this.logger.warn(`[feature-flags] setPlatformFlag failed: ${err.message}`);
		}
	}

	async setAccountFlag(accountId: string, key: string, enabled: boolean): Promise<void> {
		if (!this.ok) return;
		try {
			await this.client.set(`cms:features:${accountId}:${key}`, enabled ? '1' : '0');
		} catch (err: any) {
			this.logger.warn(`[feature-flags] setAccountFlag failed: ${err.message}`);
		}
	}

	async deleteAccountFlag(accountId: string, key: string): Promise<void> {
		if (!this.ok) return;
		try {
			await this.client.del(`cms:features:${accountId}:${key}`);
		} catch (err: any) {
			this.logger.warn(`[feature-flags] deleteAccountFlag failed: ${err.message}`);
		}
	}

	async quit(): Promise<void> {
		try {
			await this.client.quit();
		} catch { /* ignore */ }
	}
}

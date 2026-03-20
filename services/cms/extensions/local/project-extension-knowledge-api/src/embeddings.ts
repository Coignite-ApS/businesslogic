import OpenAI from 'openai';

export class EmbeddingClient {
	private client: OpenAI;
	private model: string;

	constructor(apiKey: string, model: string = 'text-embedding-3-small') {
		this.client = new OpenAI({ apiKey });
		this.model = model;
	}

	/** Embed a single query text */
	async embedQuery(text: string): Promise<number[]> {
		const response = await this.client.embeddings.create({
			model: this.model,
			input: text,
		});
		return response.data[0].embedding;
	}

	/** Embed a batch of texts (max 100 per call) */
	async embedBatch(texts: string[]): Promise<number[][]> {
		const results: number[][] = [];
		const batchSize = 100;

		for (let i = 0; i < texts.length; i += batchSize) {
			const batch = texts.slice(i, i + batchSize);
			const response = await this.callWithRetry(() =>
				this.client.embeddings.create({
					model: this.model,
					input: batch,
				}),
			);

			// Sort by index to maintain order
			const sorted = response.data.sort((a, b) => a.index - b.index);
			for (const item of sorted) {
				results.push(item.embedding);
			}
		}

		return results;
	}

	private async callWithRetry<T>(fn: () => Promise<T>, retries: number = 3): Promise<T> {
		for (let attempt = 0; attempt < retries; attempt++) {
			try {
				return await fn();
			} catch (err: any) {
				if (err?.status === 429 && attempt < retries - 1) {
					const waitMs = Math.min(1000 * Math.pow(2, attempt), 10000);
					await new Promise((r) => setTimeout(r, waitMs));
					continue;
				}
				throw err;
			}
		}
		throw new Error('Max retries exceeded');
	}
}

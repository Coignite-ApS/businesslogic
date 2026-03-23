import { describe, it, expect } from 'vitest';
import { languages, maskToken } from '../utils/code-snippets';
import type { FormulaSnippetParams } from '../utils/code-snippets';

const params: FormulaSnippetParams = {
	baseUrl: 'https://api.example.com',
	apiKey: 'test-api-key-12345',
};

describe('code-snippets', () => {
	describe('all 7 languages use X-API-Key header', () => {
		for (const lang of languages) {
			it(`${lang.label} single endpoint uses X-API-Key`, () => {
				const snippet = lang.snippet('single', params);
				expect(snippet).toContain('X-API-Key');
				expect(snippet).not.toContain('X-Auth-Token');
			});

			it(`${lang.label} batch endpoint uses X-API-Key`, () => {
				const snippet = lang.snippet('batch', params);
				expect(snippet).toContain('X-API-Key');
				expect(snippet).not.toContain('X-Auth-Token');
			});

			it(`${lang.label} sheet endpoint uses X-API-Key`, () => {
				const snippet = lang.snippet('sheet', params);
				expect(snippet).toContain('X-API-Key');
				expect(snippet).not.toContain('X-Auth-Token');
			});
		}
	});

	describe('all snippets use gateway URL', () => {
		for (const lang of languages) {
			it(`${lang.label} includes baseUrl in snippet`, () => {
				const snippet = lang.snippet('single', params);
				expect(snippet).toContain(params.baseUrl);
			});
		}
	});

	describe('all snippets include apiKey value', () => {
		for (const lang of languages) {
			it(`${lang.label} includes apiKey`, () => {
				const snippet = lang.snippet('single', params);
				expect(snippet).toContain(params.apiKey);
			});
		}
	});

	describe('interface uses apiKey not token', () => {
		it('params have apiKey property', () => {
			const p: FormulaSnippetParams = { baseUrl: 'http://x', apiKey: 'k' };
			expect(p.apiKey).toBe('k');
			expect((p as any).token).toBeUndefined();
		});
	});

	describe('maskToken', () => {
		it('masks middle of long tokens', () => {
			expect(maskToken('abcd1234efgh5678')).toBe('abcd********5678');
		});

		it('masks short tokens entirely', () => {
			expect(maskToken('short')).toBe('*****');
		});

		it('handles exactly 8 chars', () => {
			expect(maskToken('12345678')).toBe('********');
		});
	});
});

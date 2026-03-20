import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, isEncrypted } from '../crypto.js';
import { randomBytes } from 'node:crypto';

const validKey = randomBytes(32).toString('hex'); // 64 hex chars = 32 bytes

describe('crypto', () => {
	describe('encrypt / decrypt round-trip', () => {
		it('encrypts and decrypts a simple string', () => {
			const plaintext = 'my-secret-token-123';
			const encrypted = encrypt(plaintext, validKey);
			expect(encrypted).toMatch(/^v1:/);
			expect(encrypted).not.toBe(plaintext);

			const decrypted = decrypt(encrypted, validKey);
			expect(decrypted).toBe(plaintext);
		});

		it('produces different ciphertext for the same plaintext (random IV)', () => {
			const plaintext = 'same-value';
			const a = encrypt(plaintext, validKey);
			const b = encrypt(plaintext, validKey);
			expect(a).not.toBe(b);
			// But both decrypt to the same value
			expect(decrypt(a, validKey)).toBe(plaintext);
			expect(decrypt(b, validKey)).toBe(plaintext);
		});

		it('handles empty string', () => {
			const encrypted = encrypt('', validKey);
			expect(decrypt(encrypted, validKey)).toBe('');
		});

		it('handles unicode', () => {
			const plaintext = 'tökén-with-ünîcödë-🔑';
			const encrypted = encrypt(plaintext, validKey);
			expect(decrypt(encrypted, validKey)).toBe(plaintext);
		});

		it('handles long strings', () => {
			const plaintext = 'x'.repeat(10000);
			const encrypted = encrypt(plaintext, validKey);
			expect(decrypt(encrypted, validKey)).toBe(plaintext);
		});
	});

	describe('isEncrypted', () => {
		it('returns true for encrypted values', () => {
			const encrypted = encrypt('test', validKey);
			expect(isEncrypted(encrypted)).toBe(true);
		});

		it('returns false for plaintext', () => {
			expect(isEncrypted('plaintext-token')).toBe(false);
			expect(isEncrypted('')).toBe(false);
			expect(isEncrypted('v2:something')).toBe(false);
		});

		it('returns true for v1: prefix', () => {
			expect(isEncrypted('v1:abc:def:ghi')).toBe(true);
		});
	});

	describe('error handling', () => {
		it('throws on invalid key length for encrypt', () => {
			expect(() => encrypt('test', 'short')).toThrow('32 bytes');
		});

		it('throws on invalid key length for decrypt', () => {
			const encrypted = encrypt('test', validKey);
			expect(() => decrypt(encrypted, 'short')).toThrow('32 bytes');
		});

		it('throws when decrypting non-encrypted value', () => {
			expect(() => decrypt('not-encrypted', validKey)).toThrow('not encrypted');
		});

		it('throws on tampered ciphertext', () => {
			const encrypted = encrypt('test', validKey);
			const tampered = encrypted.slice(0, -2) + 'XX';
			expect(() => decrypt(tampered, validKey)).toThrow();
		});

		it('throws when decrypting with wrong key', () => {
			const encrypted = encrypt('test', validKey);
			const wrongKey = randomBytes(32).toString('hex');
			expect(() => decrypt(encrypted, wrongKey)).toThrow();
		});

		it('throws on malformed encrypted format', () => {
			expect(() => decrypt('v1:only-two-parts', validKey)).toThrow('Invalid encrypted format');
		});
	});
});

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const PREFIX = 'v1:';

/** Check if a value is already encrypted (has v1: prefix) */
export function isEncrypted(value: string): boolean {
	return value.startsWith(PREFIX);
}

/** Encrypt plaintext using AES-256-GCM. Returns `v1:<iv>:<tag>:<ciphertext>` (base64). */
export function encrypt(plaintext: string, key: string): string {
	const keyBuf = Buffer.from(key, 'hex');
	if (keyBuf.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');

	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, keyBuf, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();

	return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/** Decrypt a `v1:<iv>:<tag>:<ciphertext>` string back to plaintext. */
export function decrypt(encrypted: string, key: string): string {
	if (!isEncrypted(encrypted)) throw new Error('Value is not encrypted (missing v1: prefix)');

	const keyBuf = Buffer.from(key, 'hex');
	if (keyBuf.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');

	const parts = encrypted.slice(PREFIX.length).split(':');
	if (parts.length !== 3) throw new Error('Invalid encrypted format');

	const iv = Buffer.from(parts[0], 'base64');
	const tag = Buffer.from(parts[1], 'base64');
	const ciphertext = Buffer.from(parts[2], 'base64');

	const decipher = createDecipheriv(ALGORITHM, keyBuf, iv);
	decipher.setAuthTag(tag);
	return decipher.update(ciphertext) + decipher.final('utf8');
}

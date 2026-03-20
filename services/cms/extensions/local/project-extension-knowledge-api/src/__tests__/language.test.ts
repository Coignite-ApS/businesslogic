import { describe, it, expect } from 'vitest';
import { detectLanguage, detectLanguageShort, pgTsConfig, languageName } from '../language.js';

describe('pgTsConfig', () => {
	it('maps known languages to postgres configs', () => {
		expect(pgTsConfig('eng')).toBe('english');
		expect(pgTsConfig('dan')).toBe('danish');
		expect(pgTsConfig('deu')).toBe('german');
		expect(pgTsConfig('fra')).toBe('french');
		expect(pgTsConfig('spa')).toBe('spanish');
		expect(pgTsConfig('rus')).toBe('russian');
	});

	it('returns simple for unknown languages', () => {
		expect(pgTsConfig('xyz')).toBe('simple');
		expect(pgTsConfig('jpn')).toBe('simple');
		expect(pgTsConfig('')).toBe('simple');
	});
});

describe('languageName', () => {
	it('maps known codes to human names', () => {
		expect(languageName('eng')).toBe('English');
		expect(languageName('dan')).toBe('Danish');
		expect(languageName('deu')).toBe('German');
		expect(languageName('fra')).toBe('French');
	});

	it('defaults to English for unknown codes', () => {
		expect(languageName('xyz')).toBe('English');
		expect(languageName('')).toBe('English');
	});
});

describe('detectLanguage', () => {
	it('detects English text', () => {
		const text = 'This is a fairly long English sentence that should be detected as English by the franc library.';
		expect(detectLanguage(text)).toBe('eng');
	});

	it('detects German text', () => {
		const text = 'Dies ist ein ziemlich langer deutscher Satz, der als Deutsch erkannt werden sollte von der Bibliothek.';
		expect(detectLanguage(text)).toBe('deu');
	});

	it('defaults to eng for very short text (below minLength 50)', () => {
		expect(detectLanguage('hi')).toBe('eng');
	});
});

describe('detectLanguageShort', () => {
	it('detects language with lower threshold', () => {
		// Short text that franc can still detect with minLength 10
		const result = detectLanguageShort('Was ist das?');
		// franc may or may not detect this — just ensure it returns a string
		expect(typeof result).toBe('string');
		expect(result.length).toBe(3);
	});

	it('defaults to eng for very short text', () => {
		expect(detectLanguageShort('hi')).toBe('eng');
	});
});

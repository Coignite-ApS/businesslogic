import { franc } from 'franc';

/** ISO 639-3 → PostgreSQL text search config */
const PG_TSCONFIG_MAP: Record<string, string> = {
	eng: 'english',
	dan: 'danish',
	deu: 'german',
	fra: 'french',
	nld: 'dutch',
	spa: 'spanish',
	ita: 'italian',
	por: 'portuguese',
	fin: 'finnish',
	swe: 'swedish',
	nor: 'norwegian',
	hun: 'hungarian',
	ron: 'romanian',
	rus: 'russian',
	tur: 'turkish',
};

/** ISO 639-3 → human-readable language name (for LLM prompts) */
const LANGUAGE_NAMES: Record<string, string> = {
	eng: 'English',
	dan: 'Danish',
	deu: 'German',
	fra: 'French',
	nld: 'Dutch',
	spa: 'Spanish',
	ita: 'Italian',
	por: 'Portuguese',
	fin: 'Finnish',
	swe: 'Swedish',
	nor: 'Norwegian',
	hun: 'Hungarian',
	ron: 'Romanian',
	rus: 'Russian',
	tur: 'Turkish',
};

/** Detect language from text, returns ISO 639-3 code */
export function detectLanguage(text: string): string {
	const code = franc(text, { minLength: 50 });
	return code === 'und' ? 'eng' : code;
}

/** Detect language for short text (lower minLength threshold) */
export function detectLanguageShort(text: string): string {
	const code = franc(text, { minLength: 10 });
	return code === 'und' ? 'eng' : code;
}

/** Map ISO 639-3 code to PostgreSQL tsconfig name */
export function pgTsConfig(lang: string): string {
	return PG_TSCONFIG_MAP[lang] || 'simple';
}

/** Map ISO 639-3 code to human-readable language name */
export function languageName(lang: string): string {
	return LANGUAGE_NAMES[lang] || 'English';
}

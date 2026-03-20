import { franc } from 'franc';

const PG_TSCONFIG_MAP = {
  eng: 'english', dan: 'danish', deu: 'german', fra: 'french',
  nld: 'dutch', spa: 'spanish', ita: 'italian', por: 'portuguese',
  fin: 'finnish', swe: 'swedish', nor: 'norwegian', hun: 'hungarian',
  ron: 'romanian', rus: 'russian', tur: 'turkish',
};

const LANGUAGE_NAMES = {
  eng: 'English', dan: 'Danish', deu: 'German', fra: 'French',
  nld: 'Dutch', spa: 'Spanish', ita: 'Italian', por: 'Portuguese',
  fin: 'Finnish', swe: 'Swedish', nor: 'Norwegian', hun: 'Hungarian',
  ron: 'Romanian', rus: 'Russian', tur: 'Turkish',
};

export function detectLanguage(text) {
  const code = franc(text, { minLength: 50 });
  return code === 'und' ? 'eng' : code;
}

export function detectLanguageShort(text) {
  const code = franc(text, { minLength: 10 });
  return code === 'und' ? 'eng' : code;
}

export function pgTsConfig(lang) {
  return PG_TSCONFIG_MAP[lang] || 'simple';
}

export function languageName(lang) {
  return LANGUAGE_NAMES[lang] || 'English';
}

// XLSX formula prefix handling for Excel compatibility
// Excel requires _xlfn. and _xlfn._xlws. prefixes on modern function names in XLSX XML.
// Without them, Excel shows #NAME?.

// Dynamic array functions need _xlfn._xlws. prefix (not just _xlfn.)
const XLWS_FUNCTIONS = new Set([
  'SORT', 'FILTER', 'UNIQUE', 'RANDARRAY', 'SEQUENCE', 'SORTBY', 'XMATCH',
]);

// Functions that need _xlfn. prefix in XLSX (modern/dotted functions added after Excel 2010)
const XLFN_FUNCTIONS = new Set([
  // Dotted stat functions
  'NORM.DIST', 'NORM.INV', 'NORM.S.DIST', 'NORM.S.INV',
  'T.DIST', 'T.DIST.2T', 'T.DIST.RT', 'T.INV', 'T.INV.2T', 'T.TEST',
  'CHISQ.DIST', 'CHISQ.DIST.RT', 'CHISQ.INV', 'CHISQ.INV.RT', 'CHISQ.TEST',
  'F.DIST', 'F.DIST.RT', 'F.INV', 'F.INV.RT', 'F.TEST',
  'BETA.DIST', 'BETA.INV', 'BINOM.DIST', 'BINOM.INV',
  'EXPON.DIST', 'GAMMA.DIST', 'GAMMA.INV',
  'GAMMALN.PRECISE', 'HYPGEOM.DIST',
  'LOGNORM.DIST', 'LOGNORM.INV', 'NEGBINOM.DIST',
  'POISSON.DIST', 'WEIBULL.DIST',
  'CONFIDENCE.NORM', 'CONFIDENCE.T',
  'COVARIANCE.P', 'COVARIANCE.S',
  'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P',
  'RANK.EQ', 'RANK.AVG',
  'PERCENTILE.INC', 'PERCENTILE.EXC',
  'PERCENTRANK.INC', 'PERCENTRANK.EXC',
  'QUARTILE.INC', 'QUARTILE.EXC',
  'MODE.SNGL', 'MODE.MULT',
  'SKEW.P', 'Z.TEST', 'ERROR.TYPE',
  // Dotted ceiling/floor
  'CEILING.MATH', 'CEILING.PRECISE', 'ISO.CEILING',
  'FLOOR.MATH', 'FLOOR.PRECISE',
  // Dotted engineering
  'ERF.PRECISE', 'ERFC.PRECISE',
  // Excel 2013 math/trig
  'COT', 'COTH', 'CSC', 'CSCH', 'SEC', 'SECH', 'ACOT', 'ACOTH',
  // Excel 2013 stat
  'PHI', 'GAUSS', 'GAMMA',
  // Excel 2013 engineering
  'BITAND', 'BITOR', 'BITXOR', 'BITLSHIFT', 'BITRSHIFT',
  // Modern functions (post-2010)
  'CONCAT', 'TEXTJOIN', 'IFS', 'SWITCH', 'XOR', 'IFNA',
  'MAXIFS', 'MINIFS', 'ISOWEEKNUM',
  'NUMBERVALUE', 'UNICODE', 'UNICHAR',
  'BASE', 'DECIMAL', 'ARABIC',
  'DAYS', 'FORMULATEXT', 'ISFORMULA',
  'COMBINA', 'PDURATION', 'RRI',
  // Dynamic array / lookup (XLWS ones also listed here for _xlfn. layer)
  'XLOOKUP',
  'SORT', 'FILTER', 'UNIQUE', 'RANDARRAY', 'SEQUENCE', 'SORTBY', 'XMATCH',
]);

// Build regex: match function names NOT preceded by a dot (already prefixed).
// Negative lookbehind (?<!\.) prevents matching "._xlws.SORT(" etc.
// Longest names first to avoid partial matches (e.g. NORM.S.DIST before NORM.S).
const allFnNames = [...XLFN_FUNCTIONS].sort((a, b) => b.length - a.length);
const FN_PATTERN = new RegExp(
  `(?<!\\.)\\b(${allFnNames.map(n => n.replace(/\./g, '\\.')).join('|')})\\s*\\(`,
  'g'
);

/**
 * Add _xlfn. / _xlfn._xlws. prefixes to formulas for XLSX export.
 * Idempotent — already-prefixed functions are not double-prefixed.
 */
export function addXlsxPrefixes(formula) {
  return formula.replace(FN_PATTERN, (match, fnName) => {
    if (XLWS_FUNCTIONS.has(fnName)) {
      return `_xlfn._xlws.${fnName}(`;
    }
    return `_xlfn.${fnName}(`;
  });
}

/**
 * Strip _xlfn. and _xlfn._xlws. prefixes from formulas for import.
 * Idempotent — already-clean formulas pass through unchanged.
 */
export function stripXlsxPrefixes(formula) {
  return formula.replace(/_xlfn\.(_xlws\.)?/g, '');
}

// Blocked functions and error type remapping
// Edit these lists to control what the API exposes

// Functions to block — returned as NAME error (identical to unknown function)
// Case-insensitive matching, detected at any nesting depth
export const blockedFunctions = [
  // Engine identifiers
  'VERSION',

  // HyperFormula-only (not in any Excel version)
  'ISBINARY',
  'MAXPOOL',
  'MEDIANPOOL',

  // Google Sheets only (not in Excel)
  'COUNTUNIQUE',    // Excel: COUNTA(UNIQUE())
  'ARRAY_CONSTRAIN',
  'ARRAYFORMULA',
  'INTERVAL',
  'SPLIT',          // Excel: TEXTSPLIT (different name)
];

// Remap engine-specific error types to standard Excel equivalents
// Prevents error type fingerprinting
export const errorTypeMap = {
  CYCLE: 'REF',   // HF returns CYCLE, Excel returns REF
  SPILL: 'REF',   // HF-specific array spill
  LIC: 'NAME',    // License error — should never fire with gpl-v3
};

// Volatile functions — non-deterministic, must never be cached
// If any of these appear anywhere in a formula, skip cache entirely
export const volatileFunctions = [
  'RAND',
  'RANDBETWEEN',
  'NOW',
  'TODAY',
];

// Pre-compiled regex from blocked list — single .test() per formula
// Matches function name followed by ( with optional whitespace
// Boundary ensures no partial matches (e.g. "MYVERSION" won't match)
const buildRe = (fns) => {
  const p = fns.map((fn) => fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?<![A-Za-z])(${p})\\s*\\(`, 'i');
};
export const blockedRe = buildRe(blockedFunctions);
export const volatileRe = buildRe(volatileFunctions);

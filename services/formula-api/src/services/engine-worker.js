import { parentPort } from 'node:worker_threads';
import HF from 'hyperformula';
import { enUS, daDK, deDE, esES, fiFI, frFR, huHU, itIT, nbNO, nlNL, plPL, ptPT, svSE, trTR, csCZ, ruRU } from 'hyperformula/i18n/languages';
import { config, resolveLocale } from '../config.js';

const { HyperFormula } = HF;

// Register all languages
const LANGUAGES = { enUS, daDK, deDE, esES, fiFI, frFR, huHU, itIT, nbNO, nlNL, plPL, ptPT, svSE, trTR, csCZ, ruRU };
for (const [name, lang] of Object.entries(LANGUAGES)) {
  HyperFormula.registerLanguage(name, lang);
}

const BASE_OPTIONS = { licenseKey: 'gpl-v3', precisionRounding: 14 };

// Build reverse translation maps: localized function name → English name.
// HyperFormula only parses English function names; locale affects serialization only.
// We pre-translate localized names before evaluation so users can write СУММ, SOMME, etc.
const localeFnMaps = new Map(); // locale → { regex, map }
for (const [locale, lang] of Object.entries(LANGUAGES)) {
  if (locale === 'enUS') continue; // English needs no translation
  const map = new Map();
  for (const [enName, localName] of Object.entries(lang.functions)) {
    if (localName !== enName) map.set(localName, enName);
  }
  if (map.size === 0) continue;
  // Build regex matching localized names followed by ( — longest match first
  const names = [...map.keys()].sort((a, b) => b.length - a.length);
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp('(?<![A-Za-z\\u0400-\\u04FF])(' + escaped.join('|') + ')(?=\\s*\\()', 'g');
  localeFnMaps.set(locale, { regex, map });
}

// Translate localized function names to English for a given locale
const translateFunctions = (formula, locale) => {
  const entry = localeFnMaps.get(locale);
  if (!entry) return formula;
  return formula.replace(entry.regex, (match) => entry.map.get(match) || match);
};

// Excel allows bare TRUE/FALSE; HyperFormula only has TRUE()/FALSE() functions.
// Register as named expressions so bare references resolve correctly.
const addBooleanNames = (hf) => {
  hf.addNamedExpression('TRUE', '=TRUE()');
  hf.addNamedExpression('FALSE', '=FALSE()');
};
// Prefix string cell values with ' so HyperFormula treats them as text.
// Without this, "0201" becomes 201 (leading zeros lost), "true" becomes boolean, etc.
// Returns new arrays (non-mutating — originals may be stored for rebuild).
const preserveStrings = (grid) => {
  const out = new Array(grid.length);
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row)) { out[r] = row; continue; }
    const nr = new Array(row.length);
    for (let c = 0; c < row.length; c++) {
      nr[c] = (typeof row[c] === 'string' && row[c] !== '' && row[c].charCodeAt(0) !== 61)
        ? "'" + row[c] : row[c];
    }
    out[r] = nr;
  }
  return out;
};

const preserveSheetsStrings = (sheets) => {
  const out = {};
  for (const [name, grid] of Object.entries(sheets)) {
    out[name] = preserveStrings(grid);
  }
  return out;
};

// Inline named expressions into formula strings by replacing expression names
// with their actual cell/range references. This avoids HyperFormula's named
// expression limitations (scoped expressions can't be referenced cross-sheet,
// Sheet!NamedExpr syntax not supported).
const buildInlineRe = (expressions) => {
  if (!expressions?.length) return null;
  const names = expressions.map(e => e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Match optional Sheet! qualifier followed by expression name (word boundary)
  return new RegExp("(?:'[^']*'!|[A-Za-z0-9_]+!)?(" + names.join('|') + ')\\b', 'g');
};

const inlineExpressions = (formulaStr, re, exprMap) => {
  if (!re) return formulaStr;
  return formulaStr.replace(re, (match, name) => {
    const expr = exprMap.get(name);
    if (!expr) return match;
    // expression is "=Sheet!$A$1:$B$10" — strip leading "="
    return expr.expression.charAt(0) === '=' ? expr.expression.slice(1) : expr.expression;
  });
};

// Apply all formula transformations: inline expressions + compatibility rewrites
const fixFormula = (formula, inlineRe, exprMap) => {
  let f = formula;
  if (inlineRe && exprMap) f = inlineExpressions(f, inlineRe, exprMap);
  f = rewriteFormulas(f);
  return f;
};

const inlineFormulas = (formulas, expressions) => {
  const re = expressions?.length ? buildInlineRe(expressions) : null;
  const exprMap = expressions?.length ? new Map(expressions.map(e => [e.name, e])) : null;
  return formulas.map(f => {
    const fixed = fixFormula(f.formula, re, exprMap);
    return fixed === f.formula ? f : { ...f, formula: fixed };
  });
};

// ── Iterative calculation for circular references ─────────────────────
// Excel resolves circular refs by iterating until convergence.
// HyperFormula flags them as #CYCLE!. We detect cycle cells, then iterate:
// seed all cycle cells with 0, evaluate each formula one at a time (Gauss-Seidel),
// read result, set as value, repeat until convergence or max iterations.
const ITER_MAX = 100;          // Excel default
const ITER_TOLERANCE = 0.0001; // tighter than Excel default (0.001) for better accuracy

// Check if a cell value is a CYCLE error
const isCycle = (v) => v !== null && typeof v === 'object' && 'type' in v && v.type === 'CYCLE';

// Scan formula cells for CYCLE errors, return array of { sheet, row, col, formula }.
// When formulaCells is provided (array of {sheet,row,col}), only those cells are checked.
// Otherwise falls back to scanning all cells (slower, used for evalSheet/evalMultiSheet).
function detectCycles(hf, formulaCells) {
  const cycles = [];
  if (formulaCells) {
    for (const fc of formulaCells) {
      const v = hf.getCellValue({ sheet: fc.sheet, row: fc.row, col: fc.col });
      if (isCycle(v)) {
        const formula = hf.getCellFormula({ sheet: fc.sheet, row: fc.row, col: fc.col });
        if (formula) cycles.push({ sheet: fc.sheet, row: fc.row, col: fc.col, formula });
      }
    }
  } else {
    const sheetCount = hf.countSheets();
    for (let s = 0; s < sheetCount; s++) {
      const { height, width } = hf.getSheetDimensions(s);
      for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
          const v = hf.getCellValue({ sheet: s, row: r, col: c });
          if (isCycle(v)) {
            const formula = hf.getCellFormula({ sheet: s, row: r, col: c });
            if (formula) cycles.push({ sheet: s, row: r, col: c, formula });
          }
        }
      }
    }
  }
  return cycles;
}

// Shrink self-referencing ranges in cycle cell formulas.
// HyperFormula marks cells as CYCLE when their formula references a range that
// includes the cell itself, even if the VLOOKUP/HLOOKUP never reads from that
// row/column (false positive). Fix by shrinking the range boundary that overlaps
// the cell's position. E.g. VLOOKUP(1,$A$948:$M$957,3,FALSE) in cell C957
// becomes VLOOKUP(1,$A$948:$M$956,3,FALSE) — row 957 excluded.
const RANGE_RE = /(\$?[A-Z]{1,3})(\$?)(\d+):(\$?[A-Z]{1,3})(\$?)(\d+)/g;

function shrinkSelfRefs(formula, row, col) {
  return formula.replace(RANGE_RE, (match, c1, d1, r1, c2, d2, r2) => {
    const startRow = parseInt(r1) - 1; // 0-indexed
    const endRow = parseInt(r2) - 1;
    const startCol = c1.replace(/\$/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const endCol = c2.replace(/\$/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;

    // Only shrink if the range actually contains this cell
    if (row < startRow || row > endRow || col < startCol || col > endCol) return match;

    // Shrink the boundary closest to the cell
    let newR1 = parseInt(r1), newR2 = parseInt(r2);
    let newC1 = c1, newC2 = c2;
    if (row === endRow && endRow > startRow) {
      newR2 = endRow; // shrink end row by 1 (r2 is 1-indexed)
    } else if (row === startRow && startRow < endRow) {
      newR1 = startRow + 2; // shrink start row by 1
    }
    // For column-based self-refs (rare, but handle)
    // Skip if row was already adjusted
    if (newR1 === parseInt(r1) && newR2 === parseInt(r2)) {
      if (col === endCol && endCol > startCol) {
        const letter = colLetterFromIdx(endCol - 1);
        newC2 = c2.startsWith('$') ? '$' + letter : letter;
      } else if (col === startCol && startCol < endCol) {
        const letter = colLetterFromIdx(startCol + 1);
        newC1 = c1.startsWith('$') ? '$' + letter : letter;
      }
    }

    return newC1 + d1 + newR1 + ':' + newC2 + d2 + newR2;
  });
}

function colLetterFromIdx(c) {
  let s = ''; let n = c;
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
  return s;
}

// Resolve circular references via Gauss-Seidel iteration.
// Modifies the engine in-place: cycle cells end up with converged values (not formulas).
// If cycles array is provided, uses it directly (skips detection scan).
function resolveCycles(hf, cycles) {
  if (!cycles) {
    cycles = detectCycles(hf);
    if (!cycles.length) return;
  }

  // Pre-process: shrink self-referencing ranges so HyperFormula doesn't
  // return CYCLE on re-insertion. Store the fixed formulas.
  const fixedFormulas = cycles.map(c => shrinkSelfRefs(c.formula, c.row, c.col));

  // Seed: replace all cycle formulas with 0
  hf.suspendEvaluation();
  for (const c of cycles) {
    hf.setCellContents({ sheet: c.sheet, row: c.row, col: c.col }, [[0]]);
  }
  hf.resumeEvaluation();

  const values = new Float64Array(cycles.length); // current iteration values (all 0)

  for (let iter = 0; iter < ITER_MAX; iter++) {
    let maxDelta = 0;

    for (let i = 0; i < cycles.length; i++) {
      const c = cycles[i];
      // Set fixed formula (self-refs shrunk), evaluate, read result
      hf.setCellContents({ sheet: c.sheet, row: c.row, col: c.col }, [[fixedFormulas[i]]]);
      const raw = hf.getCellValue({ sheet: c.sheet, row: c.row, col: c.col });

      // Extract numeric value (non-numeric cycle cells can't converge — keep last value)
      let val;
      if (typeof raw === 'number') {
        val = raw;
      } else if (isCycle(raw)) {
        // Still cyclic after shrink — keep previous value
        val = values[i];
      } else {
        // Non-numeric result (string, boolean, error) — freeze it
        val = values[i];
      }

      // Set back to value for other cells to reference
      hf.setCellContents({ sheet: c.sheet, row: c.row, col: c.col }, [[val]]);

      const delta = Math.abs(val - values[i]);
      if (delta > maxDelta) maxDelta = delta;
      values[i] = val;
    }

    if (maxDelta < ITER_TOLERANCE) break;
  }
}

// ── Formula compatibility rewrites ────────────────────────────────────
// HyperFormula doesn't support array comparisons inside MATCH:
//   MATCH(TRUE, range > value, 0)  → (MATCH(value, range, 1) + 1)
//   MATCH(TRUE, range < value, 0)  → (MATCH(value, range, -1) + 1)
// These are equivalent when the range is sorted (ascending for >, descending for <).
const MATCH_TRUE_RE = /MATCH\s*\(\s*TRUE\s*,\s*([^,><=]+?)\s*(>|<)\s*([^,]+?)\s*,\s*0\s*\)/gi;

function rewriteFormulas(formula) {
  return formula.replace(MATCH_TRUE_RE, (match, range, op, value) => {
    const matchType = op === '>' ? '1' : '-1';
    return '(MATCH(' + value.trim() + ',' + range.trim() + ',' + matchType + ')+1)';
  });
}

const COMMA_LOCALES = new Set(['enUS']);
const separatorFor = (locale) => COMMA_LOCALES.has(locale) ? ',' : ';';

// Calculator storage: calculatorId → { engine, sheetIds, inputMappings, outputScalars, outputRanges, originalSheets, originalFormulas, locale, lastUsed }
const calculators = new Map();
const CALCULATOR_TTL_MS = (parseInt(process.env.CALCULATOR_TTL_SECONDS || '1800', 10)) * 1000;
const MAX_CALCULATORS = parseInt(process.env.MAX_CALCULATORS_PER_WORKER || '10', 10);

// TTL sweep every 30s
setInterval(() => {
  const now = Date.now();
  for (const [id, calc] of calculators) {
    if (now - calc.lastUsed > CALCULATOR_TTL_MS) {
      calc.engine.destroy();
      calculators.delete(id);
    }
  }
}, 30000).unref();

// Persistent engine for default locale
const engine = HyperFormula.buildEmpty({ ...BASE_OPTIONS, language: config.defaultLocale });
addBooleanNames(engine);
const sheetName = engine.addSheet('W');
const sheetId = engine.getSheetId(sheetName);

// Serialize HyperFormula CellError to plain object
const serialize = (v) => {
  if (v !== null && typeof v === 'object' && 'type' in v) {
    return { type: v.type, message: v.message, value: v.value };
  }
  return v;
};

const toExpr = (f) => f.charCodeAt(0) === 61 ? f : '=' + f;

// Read result from a clean sheet (only formula at 0,0 + its spill)
// Trims trailing all-null rows/cols (e.g. FILTER pads output to input size)
function readSpill(hf, sid) {
  const { height, width } = hf.getSheetDimensions(sid);
  if (height <= 1 && width <= 1) {
    return serialize(hf.getCellValue({ sheet: sid, row: 0, col: 0 }));
  }
  const grid = new Array(height);
  for (let r = 0; r < height; r++) {
    const row = new Array(width);
    for (let c = 0; c < width; c++) {
      row[c] = serialize(hf.getCellValue({ sheet: sid, row: r, col: c }));
    }
    grid[r] = row;
  }

  // Trim trailing all-null rows
  while (grid.length > 1 && grid[grid.length - 1].every(v => v === null)) grid.pop();

  // Trim trailing all-null columns
  let cols = grid[0].length;
  outer: while (cols > 1) {
    for (let r = 0; r < grid.length; r++) {
      if (grid[r][cols - 1] !== null) break outer;
    }
    cols--;
  }
  if (cols < grid[0].length) {
    for (let r = 0; r < grid.length; r++) grid[r] = grid[r].slice(0, cols);
  }

  // Collapsed to 1x1 after trimming → return scalar
  if (grid.length === 1 && grid[0].length === 1) return grid[0][0];
  return grid;
}

// Read result from a sheet that has data; formula at (fRow, fCol)
// Scans right and down from formula cell to detect spill extent
function readSpillAt(hf, sid, fRow, fCol) {
  const { height, width } = hf.getSheetDimensions(sid);

  let w = 1;
  for (let c = fCol + 1; c < width; c++) {
    if (hf.getCellValue({ sheet: sid, row: fRow, col: c }) === null) break;
    w++;
  }

  let h = 1;
  for (let r = fRow + 1; r < height; r++) {
    if (hf.getCellValue({ sheet: sid, row: r, col: fCol }) === null) break;
    h++;
  }

  if (w <= 1 && h <= 1) {
    return serialize(hf.getCellValue({ sheet: sid, row: fRow, col: fCol }));
  }

  const grid = new Array(h);
  for (let r = 0; r < h; r++) {
    const row = new Array(w);
    for (let c = 0; c < w; c++) {
      row[c] = serialize(hf.getCellValue({ sheet: sid, row: fRow + r, col: fCol + c }));
    }
    grid[r] = row;
  }
  return grid;
}

function evalSingle(formula, locale, expressions) {
  if (locale !== config.defaultLocale) {
    const f = translateFunctions(formula, locale);
    const tmp = HyperFormula.buildEmpty({ ...BASE_OPTIONS, language: locale, functionArgSeparator: separatorFor(locale) });
    addBooleanNames(tmp);
    const name = tmp.addSheet('T');
    const sid = tmp.getSheetId(name);
    tmp.setCellContents({ sheet: sid, row: 0, col: 0 }, [[toExpr(f)]]);
    const result = readSpill(tmp, sid);
    tmp.destroy();
    return result;
  }

  engine.setCellContents({ sheet: sheetId, row: 0, col: 0 }, [[toExpr(formula)]]);
  const result = readSpill(engine, sheetId);
  // Clear full sheet extent to prevent stale spill data
  const { height: clearH, width: clearW } = engine.getSheetDimensions(sheetId);
  if (clearH > 1 || clearW > 1) {
    const empty = Array.from({ length: clearH }, () => Array(clearW).fill(null));
    engine.setCellContents({ sheet: sheetId, row: 0, col: 0 }, empty);
  } else {
    engine.setCellContents({ sheet: sheetId, row: 0, col: 0 }, [[null]]);
  }
  return result;
}

function evalBatch(formulas, locale) {
  if (locale !== config.defaultLocale) {
    return formulas.map((f) => evalSingle(f, locale));
  }

  const len = formulas.length;
  const cells = new Array(len);
  for (let i = 0; i < len; i++) {
    cells[i] = [toExpr(formulas[i])];
  }

  engine.setCellContents({ sheet: sheetId, row: 0, col: 0 }, cells);

  const { width } = engine.getSheetDimensions(sheetId);
  const results = new Array(len);

  if (width <= 1) {
    for (let i = 0; i < len; i++) {
      results[i] = serialize(engine.getCellValue({ sheet: sheetId, row: i, col: 0 }));
    }
  } else {
    for (let i = 0; i < len; i++) {
      const vals = [];
      for (let c = 0; c < width; c++) {
        vals.push(serialize(engine.getCellValue({ sheet: sheetId, row: i, col: c })));
      }
      while (vals.length > 1 && vals[vals.length - 1] === null) vals.pop();
      results[i] = vals.length === 1 ? vals[0] : [vals];
    }
  }

  // Clear full sheet extent (spill may extend beyond column 0)
  const { height: batchH, width: batchW } = engine.getSheetDimensions(sheetId);
  const empties = Array.from({ length: batchH }, () => Array(batchW).fill(null));
  engine.setCellContents({ sheet: sheetId, row: 0, col: 0 }, empties);

  return results;
}

// Column 702 = "AAA" — beyond all 1-2 letter column refs (A-ZZ)
// Prevents formula self-reference when it targets cells beyond the data range
const FORMULA_COL_MIN = 702;

function evalSingleWithData(formula, data, locale, expressions) {
  const f = translateFunctions(formula, locale);
  const tmp = HyperFormula.buildFromArray(preserveStrings(data), {
    ...BASE_OPTIONS,
    language: locale,
    functionArgSeparator: separatorFor(locale),
  });
  addBooleanNames(tmp);

  const sid = 0;
  const dataCols = data.length > 0 ? Math.max(...data.map(r => Array.isArray(r) ? r.length : 0)) : 0;
  const fCol = Math.max(dataCols, FORMULA_COL_MIN);

  const re = buildInlineRe(expressions);
  const exprMap = expressions?.length ? new Map(expressions.map(e => [e.name, e])) : null;
  const inlined = fixFormula(f, re, exprMap);
  tmp.setCellContents({ sheet: sid, row: 0, col: fCol }, [[toExpr(inlined)]]);
  const result = readSpillAt(tmp, sid, 0, fCol);
  tmp.destroy();
  return result;
}

function evalBatchWithData(formulas, data, locale, expressions) {
  const translated = formulas.map(f => translateFunctions(f, locale));
  const tmp = HyperFormula.buildFromArray(preserveStrings(data), {
    ...BASE_OPTIONS,
    language: locale,
    functionArgSeparator: separatorFor(locale),
  });
  addBooleanNames(tmp);

  const sid = 0;
  const dataCols = data.length > 0 ? Math.max(...data.map(r => Array.isArray(r) ? r.length : 0)) : 0;
  const fCol = Math.max(dataCols, FORMULA_COL_MIN);
  const re = buildInlineRe(expressions);
  const exprMap = expressions?.length ? new Map(expressions.map(e => [e.name, e])) : null;
  const len = translated.length;

  const cells = new Array(len);
  for (let i = 0; i < len; i++) {
    cells[i] = [toExpr(fixFormula(translated[i], re, exprMap))];
  }
  tmp.setCellContents({ sheet: sid, row: 0, col: fCol }, cells);

  const { width } = tmp.getSheetDimensions(sid);
  const results = new Array(len);

  if (width <= fCol + 1) {
    for (let i = 0; i < len; i++) {
      results[i] = serialize(tmp.getCellValue({ sheet: sid, row: i, col: fCol }));
    }
  } else {
    const spillCols = width - fCol;
    for (let i = 0; i < len; i++) {
      const vals = [];
      for (let c = 0; c < spillCols; c++) {
        vals.push(serialize(tmp.getCellValue({ sheet: sid, row: i, col: fCol + c })));
      }
      while (vals.length > 1 && vals[vals.length - 1] === null) vals.pop();
      results[i] = vals.length === 1 ? vals[0] : [vals];
    }
  }

  tmp.destroy();
  return results;
}

function parseCell(cell) {
  const match = cell.match(/^([A-Za-z]+)(\d+)$/);
  const letters = match[1].toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return { col: col - 1, row: parseInt(match[2], 10) - 1 };
}

function readGrid(hf, sid) {
  const { height, width } = hf.getSheetDimensions(sid);
  const grid = new Array(height);
  for (let r = 0; r < height; r++) {
    const row = new Array(width);
    for (let c = 0; c < width; c++) {
      row[c] = serialize(hf.getCellValue({ sheet: sid, row: r, col: c }));
    }
    grid[r] = row;
  }
  return grid;
}

function evalSheet(data, formulas, locale, expressions) {
  const loc = resolveLocale(locale);
  const tmp = HyperFormula.buildFromArray(preserveStrings(data), {
    ...BASE_OPTIONS,
    language: loc,
    functionArgSeparator: separatorFor(loc),
  });
  addBooleanNames(tmp);

  const fixedFormulas = inlineFormulas(formulas, expressions);
  const sid = 0;
  for (const { cell, formula } of fixedFormulas) {
    const { col, row } = parseCell(cell);
    tmp.setCellContents({ sheet: sid, row, col }, [[toExpr(translateFunctions(formula, loc))]]);
  }

  resolveCycles(tmp);

  const results = readGrid(tmp, sid);
  tmp.destroy();
  return results;
}

function evalMultiSheet(sheets, formulas, locale, expressions) {
  const loc = resolveLocale(locale);
  const tmp = HyperFormula.buildFromSheets(preserveSheetsStrings(sheets), {
    ...BASE_OPTIONS,
    language: loc,
    functionArgSeparator: separatorFor(loc),
  });
  addBooleanNames(tmp);

  const fixedFormulas = inlineFormulas(formulas, expressions);
  const sheetNames = Object.keys(sheets);
  const defaultSheet = sheetNames[0];

  for (const { sheet = defaultSheet, cell, formula } of fixedFormulas) {
    const sid = tmp.getSheetId(sheet);
    if (sid === undefined) throw new Error(`Sheet not found: ${sheet}`);
    const { col, row } = parseCell(cell);
    tmp.setCellContents({ sheet: sid, row, col }, [[toExpr(translateFunctions(formula, loc))]]);
  }

  resolveCycles(tmp);

  const results = {};
  for (const name of sheetNames) {
    results[name] = readGrid(tmp, tmp.getSheetId(name));
  }

  tmp.destroy();
  return results;
}

function buildCalculatorEngine(sheets, formulas, locale, expressions) {
  const loc = resolveLocale(locale);
  const hf = HyperFormula.buildFromSheets(preserveSheetsStrings(sheets), {
    ...BASE_OPTIONS,
    language: loc,
    functionArgSeparator: separatorFor(loc),
  });
  addBooleanNames(hf);

  const fixedFormulas = inlineFormulas(formulas, expressions);
  const sheetNames = Object.keys(sheets);
  const defaultSheet = sheetNames[0];

  // Track formula cell positions for efficient cycle detection
  const formulaCells = [];
  for (const { sheet = defaultSheet, cell, formula } of fixedFormulas) {
    const sid = hf.getSheetId(sheet);
    if (sid === undefined) throw new Error(`Sheet not found: ${sheet}`);
    const { col, row } = parseCell(cell);
    hf.setCellContents({ sheet: sid, row, col }, [[toExpr(translateFunctions(formula, loc))]]);
    formulaCells.push({ sheet: sid, row, col });
  }

  // Detect cycles using known formula positions (no full-sheet scan)
  const cycles = detectCycles(hf, formulaCells);
  if (cycles.length) resolveCycles(hf, cycles);

  // Build sheetIds lookup
  const sheetIds = {};
  for (const name of sheetNames) {
    sheetIds[name] = hf.getSheetId(name);
  }

  return { engine: hf, sheetIds, cycles };
}

function createCalculator(calculatorId, sheets, formulas, locale, inputMappings, outputScalars, outputRanges, expressions) {
  if (calculators.size >= MAX_CALCULATORS) {
    // Evict least recently used
    let oldestId = null, oldestTime = Infinity;
    for (const [id, calc] of calculators) {
      if (calc.lastUsed < oldestTime) { oldestTime = calc.lastUsed; oldestId = id; }
    }
    if (oldestId) {
      calculators.get(oldestId).engine.destroy();
      calculators.delete(oldestId);
    }
  }

  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const { engine, sheetIds, cycles } = buildCalculatorEngine(sheets, formulas, locale, expressions);
  const buildMs = Math.round(performance.now() - t0);
  const heapDeltaMB = Math.round((process.memoryUsage().heapUsed - heapBefore) / 1048576 * 10) / 10;

  // Resolve sheet names → numeric sheetIds in mappings (keep sheet name for rebuild)
  const resolvedInput = inputMappings.map((m) => ({
    sheet: m.sheet,
    sid: sheetIds[m.sheet],
    row: m.row,
    col: m.col,
    def: m.def,
  }));

  const resolvedScalars = outputScalars.map((m) => ({
    key: m.key,
    sheet: m.sheet,
    sid: sheetIds[m.sheet],
    row: m.row,
    col: m.col,
  }));

  const resolvedRanges = outputRanges.map((m) => ({
    key: m.key,
    sheet: m.sheet,
    sid: sheetIds[m.sheet],
    startRow: m.startRow,
    startCol: m.startCol,
    endRow: m.endRow,
    endCol: m.endCol,
    columns: m.columns,
  }));

  calculators.set(calculatorId, {
    engine,
    sheetIds,
    cycles,
    inputMappings: resolvedInput,
    outputScalars: resolvedScalars,
    outputRanges: resolvedRanges,
    originalSheets: sheets,
    originalFormulas: formulas,
    originalExpressions: expressions,
    locale,
    lastUsed: Date.now(),
  });

  return { ok: true, profile: { buildMs, heapDeltaMB, cycleCount: cycles.length } };
}

function readOutputs(hf, outputScalars, outputRanges) {
  const result = {};

  for (const { key, sid, row, col } of outputScalars) {
    result[key] = serialize(hf.getCellValue({ sheet: sid, row, col }));
  }

  for (const { key, sid, startRow, endRow, columns } of outputRanges) {
    const rows = [];
    for (let r = startRow; r <= endRow; r++) {
      const obj = {};
      let allNull = true;
      for (const { key: colKey, colIdx } of columns) {
        const val = serialize(hf.getCellValue({ sheet: sid, row: r, col: colIdx }));
        obj[colKey] = val;
        if (val !== null && val !== '') allNull = false;
      }
      if (!allNull) rows.push(obj);
    }
    result[key] = rows;
  }

  return result;
}

// Set calculator inputs, resolve cycles if needed, return outputs
function runCalculation(eng, inputMappings, outputScalars, outputRanges, cycles, values) {
  eng.suspendEvaluation();
  for (let i = 0; i < inputMappings.length; i++) {
    const { sid, row, col, def } = inputMappings[i];
    const v = values[i] ?? null;
    eng.setCellContents({ sheet: sid, row, col }, [[(typeof v === 'string' && v !== '' && v.charCodeAt(0) !== 61) ? "'" + v : v]]);
  }
  if (cycles.length) {
    // Restore cycle formulas (left as converged values from last run)
    for (const c of cycles) {
      eng.setCellContents({ sheet: c.sheet, row: c.row, col: c.col }, [[c.formula]]);
    }
  }
  eng.resumeEvaluation();

  if (cycles.length) resolveCycles(eng, cycles);

  return readOutputs(eng, outputScalars, outputRanges);
}

function calculate(calculatorId, values) {
  const calc = calculators.get(calculatorId);
  if (!calc) throw new Error('Calculator not found');

  try {
    const result = runCalculation(calc.engine, calc.inputMappings, calc.outputScalars, calc.outputRanges, calc.cycles, values);
    calc.lastUsed = Date.now();
    return result;
  } catch (err) {
    // Rebuild engine and retry once
    try {
      calc.engine.destroy();
      const rebuilt = buildCalculatorEngine(calc.originalSheets, calc.originalFormulas, calc.locale, calc.originalExpressions);
      calc.engine = rebuilt.engine;
      calc.sheetIds = rebuilt.sheetIds;
      calc.cycles = rebuilt.cycles;

      // Re-resolve sheetIds in mappings using stored sheet names
      calc.inputMappings = calc.inputMappings.map(m => ({ ...m, sid: rebuilt.sheetIds[m.sheet] }));
      calc.outputScalars = calc.outputScalars.map(m => ({ ...m, sid: rebuilt.sheetIds[m.sheet] }));
      calc.outputRanges = calc.outputRanges.map(m => ({ ...m, sid: rebuilt.sheetIds[m.sheet] }));

      const result = runCalculation(calc.engine, calc.inputMappings, calc.outputScalars, calc.outputRanges, calc.cycles, values);
      calc.lastUsed = Date.now();
      return result;
    } catch {
      calculators.delete(calculatorId);
      throw new Error('Calculator engine failed and could not recover');
    }
  }
}

function getStats() {
  const calcs = [];
  const now = Date.now();
  for (const [id, calc] of calculators) {
    const sheetsSize = JSON.stringify(calc.originalSheets).length;
    const formulasSize = JSON.stringify(calc.originalFormulas).length;
    const expressionsSize = calc.originalExpressions ? JSON.stringify(calc.originalExpressions).length : 0;
    calcs.push({
      id,
      locale: calc.locale,
      dataBytes: sheetsSize + formulasSize + expressionsSize,
      idleMs: now - calc.lastUsed,
    });
  }
  return { calculators: calcs, memory: process.memoryUsage() };
}

function destroyCalculator(calculatorId) {
  const calc = calculators.get(calculatorId);
  if (calc) {
    calc.engine.destroy();
    calculators.delete(calculatorId);
  }
  return { ok: true };
}

parentPort.on('message', (msg) => {
  const { id, type } = msg;
  try {
    let result;
    switch (type) {
      case 'evalSingle':
        result = evalSingle(msg.formula, msg.locale, msg.expressions);
        break;
      case 'evalBatch':
        result = evalBatch(msg.formulas, msg.locale);
        break;
      case 'evalSingleWithData':
        result = evalSingleWithData(msg.formula, msg.data, msg.locale, msg.expressions);
        break;
      case 'evalBatchWithData':
        result = evalBatchWithData(msg.formulas, msg.data, msg.locale, msg.expressions);
        break;
      case 'evalSheet':
        result = evalSheet(msg.data, msg.formulas, msg.locale, msg.expressions);
        break;
      case 'evalMultiSheet':
        result = evalMultiSheet(msg.sheets, msg.formulas, msg.locale, msg.expressions);
        break;
      case 'createCalculator':
        result = createCalculator(msg.calculatorId, msg.sheets, msg.formulas, msg.locale, msg.inputMappings, msg.outputScalars, msg.outputRanges, msg.expressions);
        break;
      case 'calculate':
        result = calculate(msg.calculatorId, msg.values);
        break;
      case 'destroyCalculator':
        result = destroyCalculator(msg.calculatorId);
        break;
      case 'getStats':
        result = getStats();
        break;
      default:
        parentPort.postMessage({ id, error: `Unknown type: ${type}` });
        return;
    }
    parentPort.postMessage({ id, result });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});

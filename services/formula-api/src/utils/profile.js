import { volatileRe, volatileFunctions } from '../blocked.js';

const FUNC_RE = /[A-Z][A-Z0-9_.]+(?=\s*\()/gi;

function countCells(sheets) {
  let total = 0;
  for (const grid of Object.values(sheets)) {
    if (!Array.isArray(grid)) continue;
    for (const row of grid) {
      if (Array.isArray(row)) total += row.length;
    }
  }
  return total;
}

function countCrossSheetRefs(formulas) {
  let count = 0;
  for (const f of formulas) {
    if (f.formula && f.formula.includes('!')) count++;
  }
  return count;
}

function countVolatile(formulas) {
  let count = 0;
  const found = new Set();
  for (const f of formulas) {
    if (f.formula && volatileRe.test(f.formula)) {
      count++;
      for (const vf of volatileFunctions) {
        if (new RegExp(`(?<![A-Za-z])${vf}\\s*\\(`, 'i').test(f.formula)) found.add(vf);
      }
    }
  }
  return { count, functions: [...found] };
}

function extractFunctions(formulas) {
  const set = new Set();
  for (const f of formulas) {
    if (!f.formula) continue;
    const matches = f.formula.match(FUNC_RE);
    if (matches) {
      for (const m of matches) set.add(m.toUpperCase());
    }
  }
  return [...set].sort();
}

export function buildStaticProfile(sheets, formulas, expressions) {
  const sheetCount = Object.keys(sheets).length;
  const totalCells = countCells(sheets);
  const formulaCount = formulas.length;
  const expressionCount = expressions?.length || 0;
  const crossSheetRefs = countCrossSheetRefs(formulas);
  const vol = countVolatile(formulas);
  const dataBytes = JSON.stringify(sheets).length + JSON.stringify(formulas).length;
  const functionsUsed = extractFunctions(formulas);

  const estimatedMemoryMB = Math.round(20 + (formulaCount * 3.5 / 1024) + (dataBytes / 1048576 * 1.5));
  const estimatedBuildMs = Math.round(formulaCount * 0.13);
  const estimatedExecMs = Math.round(formulaCount * 0.001 * 100) / 100;

  const remarks = [];

  if (formulaCount > 50000) {
    remarks.push({ level: 'error', code: 'VERY_HIGH_FORMULA_COUNT', message: `${formulaCount} formulas -- may exceed worker memory.` });
  } else if (formulaCount > 10000) {
    remarks.push({ level: 'warning', code: 'HIGH_FORMULA_COUNT', message: `${formulaCount} formulas. Expect ~${estimatedMemoryMB}MB worker heap.` });
  }

  if (vol.count > 0) {
    remarks.push({ level: 'warning', code: 'VOLATILE_FORMULAS', message: `${vol.count} volatile formulas (${vol.functions.join(', ')}) -- cache bypassed.` });
  }

  if (crossSheetRefs > 500) {
    remarks.push({ level: 'info', code: 'CROSS_SHEET_HEAVY', message: `${crossSheetRefs} cross-sheet references increase dependency graph.` });
  }

  if (sheetCount > 20) {
    remarks.push({ level: 'info', code: 'MANY_SHEETS', message: `${sheetCount} sheets -- build time increases linearly.` });
  }

  const dataMB = Math.round(dataBytes / 1048576 * 10) / 10;
  if (dataBytes > 2 * 1048576) {
    remarks.push({ level: 'warning', code: 'LARGE_DATA', message: `${dataMB}MB data payload. Consider reducing unused cells.` });
  }

  return {
    sheetCount,
    totalCells,
    formulaCount,
    expressionCount,
    crossSheetRefs,
    volatileCount: vol.count,
    dataBytes,
    estimatedMemoryMB,
    estimatedBuildMs,
    estimatedExecMs,
    functionsUsed,
    remarks,
  };
}

export function mergeWithMeasured(staticProfile, measured) {
  const profile = { ...staticProfile };
  if (measured.buildMs != null) {
    profile.buildMs = measured.buildMs;
    // Replace estimate with actual measurement
    profile.estimatedBuildMs = measured.buildMs;
  }
  if (measured.heapDeltaMB != null) profile.heapDeltaMB = measured.heapDeltaMB;
  if (measured.rustMemoryMB != null) {
    profile.rustMemoryMB = measured.rustMemoryMB;
    if (measured.rustMemoryBytes != null) profile.rustMemoryBytes = measured.rustMemoryBytes;
    // Rust-measured memory replaces heuristic estimate
    if (measured.rustMemoryMB > 0) profile.estimatedMemoryMB = measured.rustMemoryMB;
  }
  if (measured.cycleCount != null) {
    profile.cycleCount = measured.cycleCount;
    if (measured.cycleCount > 0) {
      profile.remarks = [
        ...profile.remarks,
        { level: 'info', code: 'HAS_CYCLES', message: `${measured.cycleCount} circular refs resolved via iteration.` },
      ];
    }
  }
  return profile;
}

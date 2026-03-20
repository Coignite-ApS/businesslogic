// Parse Excel-style cell/range references with optional sheet prefix
// 'SheetName'!C3   → { sheet: "SheetName", row: 2, col: 2 }
// 'Budget'!A45:F60 → { sheet: "Budget", startRow: 44, startCol: 0, endRow: 59, endCol: 5 }
// C3               → { sheet: null, row: 2, col: 2 }

// Column letters to 0-based index: A=0, B=1, Z=25, AA=26
function colToIndex(letters) {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

// 0-based index to column letters: 0=A, 25=Z, 26=AA
export function indexToCol(idx) {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

// Extract sheet name and cell/range ref from mapping string
// Supports: 'Sheet'!A1, Sheet1!A1, A1, 'Sheet'!A1:B2
const MAPPING_RE = /^(?:'([^']+)'!|([A-Za-z0-9_]+)!)?([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/;

export function parseMapping(mapping) {
  const m = mapping.match(MAPPING_RE);
  if (!m) throw new Error(`Invalid mapping: ${mapping}`);

  const sheet = m[1] || m[2] || null;
  const col1 = colToIndex(m[3].toUpperCase());
  const row1 = parseInt(m[4], 10) - 1;

  if (m[5] && m[6]) {
    // Range ref
    return {
      type: 'range',
      sheet,
      startRow: row1,
      startCol: col1,
      endRow: parseInt(m[6], 10) - 1,
      endCol: colToIndex(m[5].toUpperCase()),
    };
  }

  return { type: 'cell', sheet, row: row1, col: col1 };
}

// Parse input schema properties → positional inputMappings array
// Returns [{sheet, row, col, def, key}, ...] in property order
export function buildInputMappings(schema, defaultSheet) {
  const mappings = [];
  const props = schema.properties || {};
  for (const [key, prop] of Object.entries(props)) {
    if (!prop.mapping) throw new Error(`Input property "${key}" missing mapping`);
    const parsed = parseMapping(prop.mapping);
    if (parsed.type !== 'cell') throw new Error(`Input mapping "${key}" must be a cell, not a range`);
    mappings.push({
      key,
      sheet: parsed.sheet || defaultSheet,
      row: parsed.row,
      col: parsed.col,
      def: prop.default ?? null,
    });
  }
  return mappings;
}

// Parse output schema properties → {scalars, ranges}
export function buildOutputMappings(schema, defaultSheet) {
  const scalars = [];
  const ranges = [];
  const props = schema.properties || {};

  for (const [key, prop] of Object.entries(props)) {
    if (!prop.mapping) throw new Error(`Output property "${key}" missing mapping`);
    const parsed = parseMapping(prop.mapping);

    if (parsed.type === 'cell') {
      scalars.push({
        key,
        sheet: parsed.sheet || defaultSheet,
        row: parsed.row,
        col: parsed.col,
      });
    } else {
      // Range → array output, need mapping_item columns
      const columns = [];
      const items = prop.items?.properties || {};
      for (const [itemKey, itemProp] of Object.entries(items)) {
        if (!itemProp.mapping_item) throw new Error(`Output array "${key}.${itemKey}" missing mapping_item`);
        columns.push({
          key: itemKey,
          colIdx: colToIndex(itemProp.mapping_item.toUpperCase()),
        });
      }
      ranges.push({
        key,
        sheet: parsed.sheet || defaultSheet,
        startRow: parsed.startRow,
        startCol: parsed.startCol,
        endRow: parsed.endRow,
        endCol: parsed.endCol,
        columns,
      });
    }
  }

  return { scalars, ranges };
}


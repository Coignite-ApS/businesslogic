import ExcelJS from 'exceljs';
import { config, resolveLocale, engineToIetf } from '../config.js';
import { checkAdminToken } from '../utils/auth.js';
import { parseMapping, indexToCol } from '../utils/mapping.js';
import { addXlsxPrefixes } from '../utils/xlsx-formula.js';

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

// "#FF0000" → { border: "FFFF0000", fill: "FFFFE5E5" }
function hexToArgb(hex) {
  const c = hex.replace('#', '').toUpperCase();
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const tint = (v) => Math.round(v * 0.1 + 255 * 0.9);
  return {
    border: `FF${c}`,
    fill: `FF${[r, g, b].map((v) => tint(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase(),
  };
}

// Iterate cells from a parseMapping result, call fn(sheet, row, col) for each
function forEachCell(parsed, fn) {
  if (parsed.type === 'cell') {
    fn(parsed.sheet, parsed.row, parsed.col);
  } else {
    for (let r = parsed.startRow; r <= parsed.endRow; r++) {
      for (let c = parsed.startCol; c <= parsed.endCol; c++) {
        fn(parsed.sheet, r, c);
      }
    }
  }
}

export async function registerRoutes(app) {
  app.post('/generate/xlsx', { bodyLimit: config.maxPayloadSize }, async (req, reply) => {
    const authErr = checkAdminToken(req);
    if (authErr) return reply.code(authErr.code).send(authErr.body);

    const body = req.body;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'Invalid request body' });
    }

    const { sheets, formulas = [], highlights, comments, formats, filename, expressions, locale } = body;

    // Validate sheets
    if (!sheets || typeof sheets !== 'object' || Array.isArray(sheets) || Object.keys(sheets).length === 0) {
      return reply.code(400).send({ error: 'sheets is required and must be a non-empty object' });
    }

    if (!Array.isArray(formulas)) {
      return reply.code(400).send({ error: 'formulas must be an array' });
    }

    const sheetNames = Object.keys(sheets);
    const defaultSheet = sheetNames[0];

    // Validate hex colors upfront
    if (highlights) {
      for (const [key, color] of Object.entries(highlights)) {
        if (!HEX_RE.test(color)) {
          return reply.code(400).send({ error: `Invalid hex color "${color}" for key "${key}"` });
        }
      }
    }

    // Validate mapping keys upfront
    const allMappingKeys = [
      ...Object.keys(highlights || {}),
      ...Object.keys(comments || {}),
      ...Object.keys(formats || {}),
    ];
    for (const key of allMappingKeys) {
      try {
        parseMapping(key);
      } catch {
        return reply.code(400).send({ error: `Invalid mapping key: ${key}` });
      }
    }

    // Create workbook
    const wb = new ExcelJS.Workbook();

    // Embed locale as IETF tag in xlsx dc:language
    if (locale) {
      const ietf = engineToIetf(resolveLocale(locale));
      if (ietf) wb.language = ietf;
    }

    // Add worksheets + populate values
    const wsMap = {};
    for (const [name, grid] of Object.entries(sheets)) {
      const ws = wb.addWorksheet(name);
      wsMap[name] = ws;

      if (!Array.isArray(grid)) continue;
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length; c++) {
          if (row[c] !== null && row[c] !== undefined) {
            ws.getCell(r + 1, c + 1).value = row[c];
          }
        }
      }
    }

    // Write formulas (overwrite values)
    for (const f of formulas) {
      const sheetName = f.sheet || defaultSheet;
      const ws = wsMap[sheetName];
      if (!ws) continue; // formula references non-existent sheet, skip
      const cell = ws.getCell(f.cell);
      cell.value = { formula: addXlsxPrefixes(f.formula), result: 0 };
    }

    // Write named expressions (defined names)
    if (expressions?.length) {
      for (const { name, expression } of expressions) {
        // Convert "=Sheet1!$A$1:$C$10" → "'Sheet1'!$A$1:$C$10" for ExcelJS
        const ref = expression.startsWith('=') ? expression.slice(1) : expression;
        // Only add cell/range references (skip constant expressions like "=0.21")
        if (ref.includes('!')) {
          try { wb.definedNames.add(ref, name); } catch { /* skip invalid */ }
        }
      }
    }

    // Auto-fit column widths based on content
    for (const ws of Object.values(wsMap)) {
      ws.columns.forEach((col) => {
        let maxLen = 8;
        col.eachCell({ includeEmpty: false }, (cell) => {
          const val = cell.value;
          let len = 8;
          if (val && typeof val === 'object' && val.formula) {
            len = val.formula.length + 2;
          } else if (val != null) {
            len = String(val).length + 2;
          }
          if (len > maxLen) maxLen = len;
        });
        col.width = Math.min(maxLen, 50);
      });
    }

    // Apply highlights (border + fill)
    if (highlights) {
      for (const [key, color] of Object.entries(highlights)) {
        const parsed = parseMapping(key);
        const sheet = parsed.sheet || defaultSheet;
        const ws = wsMap[sheet];
        if (!ws) continue;

        const argb = hexToArgb(color);
        const border = {
          top: { style: 'thin', color: { argb: argb.border } },
          left: { style: 'thin', color: { argb: argb.border } },
          bottom: { style: 'thin', color: { argb: argb.border } },
          right: { style: 'thin', color: { argb: argb.border } },
        };
        const fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: argb.fill },
        };

        forEachCell(parsed, (_s, r, c) => {
          const cell = ws.getCell(r + 1, c + 1);
          cell.border = border;
          cell.fill = fill;
        });
      }
    }

    // Apply comments
    if (comments) {
      for (const [key, text] of Object.entries(comments)) {
        const parsed = parseMapping(key);
        const sheet = parsed.sheet || defaultSheet;
        const ws = wsMap[sheet];
        if (!ws) continue;

        forEachCell(parsed, (_s, r, c) => {
          ws.getCell(r + 1, c + 1).note = text;
        });
      }
    }

    // Apply number formats
    if (formats) {
      for (const [key, fmt] of Object.entries(formats)) {
        const parsed = parseMapping(key);
        const sheet = parsed.sheet || defaultSheet;
        const ws = wsMap[sheet];
        if (!ws) continue;

        forEachCell(parsed, (_s, r, c) => {
          ws.getCell(r + 1, c + 1).numFmt = fmt;
        });
      }
    }

    // Generate buffer
    const buf = await wb.xlsx.writeBuffer();

    const outFilename = filename || 'generated.xlsx';
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${outFilename}"`)
      .send(Buffer.from(buf));
  });
}

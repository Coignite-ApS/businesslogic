import ExcelJS from 'exceljs';
import { config, resolveIetfLocale } from '../config.js';
import { checkAdminToken } from '../utils/auth.js';
import { buildStaticProfile } from '../utils/profile.js';
import { stripXlsxPrefixes } from '../utils/xlsx-formula.js';

// Convert column index (0-based) to Excel letter(s): 0→A, 25→Z, 26→AA
const colLetter = (c) => {
  let s = '';
  let n = c;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
};

export async function registerRoutes(app) {
  app.post('/parse/xlsx', { bodyLimit: config.maxPayloadSize }, async (req, reply) => {
    const authErr = checkAdminToken(req);
    if (authErr) return reply.code(authErr.code).send(authErr.body);

    // Get uploaded file
    const file = await req.file();
    if (!file) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    // Validate MIME type
    const mime = file.mimetype;
    if (
      mime !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
      mime !== 'application/octet-stream'
    ) {
      return reply.code(415).send({ error: 'Unsupported file type', detail: `Expected xlsx, got ${mime}` });
    }

    // Buffer the file
    const buf = await file.toBuffer();

    // Check size (multipart plugin enforces limit too, but file.truncated catches edge cases)
    if (file.file.truncated) {
      return reply.code(413).send({
        error: 'File too large',
        detail: `Max upload size is ${config.maxPayloadSize} bytes`,
      });
    }

    // Validate ZIP magic bytes (xlsx = ZIP archive, starts with PK)
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4B) {
      return reply.code(422).send({ error: 'Invalid xlsx file', detail: 'Not a valid ZIP/xlsx archive' });
    }

    // Parse workbook
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf);
    } catch {
      return reply.code(422).send({ error: 'Invalid xlsx file' });
    }

    const sheets = {};
    const formulas = [];

    for (const ws of wb.worksheets) {
      const name = ws.name;

      if (!ws.rowCount || !ws.columnCount) {
        sheets[name] = [[]];
        continue;
      }

      const totalRows = ws.rowCount;
      const totalCols = ws.columnCount;

      // Build grid with absolute positioning
      const grid = [];
      let hasContent = false;
      for (let r = 1; r <= totalRows; r++) {
        const row = new Array(totalCols).fill(null);
        const wsRow = ws.getRow(r);
        for (let c = 1; c <= totalCols; c++) {
          const cell = wsRow.getCell(c);

          if (cell.formula) {
            row[c - 1] = null;
            formulas.push({
              sheet: name,
              cell: colLetter(c - 1) + r,
              formula: stripXlsxPrefixes(cell.formula),
            });
            hasContent = true;
          } else if (cell.value !== null && cell.value !== undefined) {
            // ExcelJS wraps rich text, dates, etc. — extract primitive value
            const v = cell.value;
            if (typeof v === 'object' && v !== null) {
              if (v.result !== undefined) {
                // Formula result object (shared formula)
                row[c - 1] = null;
                if (v.formula) {
                  formulas.push({ sheet: name, cell: colLetter(c - 1) + r, formula: stripXlsxPrefixes(v.formula) });
                  hasContent = true;
                } else if (v.sharedFormula) {
                  formulas.push({ sheet: name, cell: colLetter(c - 1) + r, formula: stripXlsxPrefixes(v.sharedFormula) });
                  hasContent = true;
                }
              } else if (v instanceof Date) {
                row[c - 1] = v;
                hasContent = true;
              } else if (v.richText) {
                row[c - 1] = v.richText.map((rt) => rt.text).join('');
                hasContent = true;
              } else if (v.text !== undefined) {
                row[c - 1] = v.text;
                hasContent = true;
              } else {
                row[c - 1] = v;
                hasContent = true;
              }
            } else {
              row[c - 1] = v;
              hasContent = true;
            }
          }
        }
        grid.push(row);
      }

      sheets[name] = hasContent ? grid : [[]];
    }

    // Extract named expressions (defined names) from ExcelJS model
    const expressions = [];
    if (wb.definedNames?.model?.length) {
      for (const entry of wb.definedNames.model) {
        const { name, ranges } = entry;
        if (!name || name.startsWith('_xlnm.')) continue;
        const ref = ranges?.[0];
        if (!ref || ref.includes('#REF')) continue;
        const expr = { name, expression: '=' + ref };
        const match = ref.match(/^'?([^'!]+)'?!/);
        if (match) {
          const sheetName = match[1];
          if (wb.worksheets.some((ws) => ws.name === sheetName)) {
            expr.scope = sheetName;
          }
        }
        expressions.push(expr);
      }
    }

    // Extract locale from xlsx dc:language tag
    const locale = resolveIetfLocale(wb.language);

    const profile = buildStaticProfile(sheets, formulas, expressions);
    const result = { sheets, formulas, expressions, profile };
    if (locale) result.locale = locale;
    return result;
  });
}

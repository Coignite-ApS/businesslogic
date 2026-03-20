// End-to-end tests: locales, caching, batch, sheet, errors, edge cases
import { describe, it } from 'node:test';
import assert from 'node:assert';

const BASE = process.env.API_URL || 'http://localhost:3000';
const FORMULA_TOKEN = process.env.FORMULA_TEST_TOKEN || '';

const authHeaders = FORMULA_TOKEN ? { 'X-Auth-Token': FORMULA_TOKEN } : {};

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders });
  return { status: res.status, data: await res.json() };
};

describe('E2E', () => {
  // ============================================================
  // HEALTH
  // ============================================================
  describe('Health', () => {
    it('returns status ok', async () => {
      const res = await fetch(`${BASE}/health`);
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.status, 'ok');
      assert.ok(data.ts > 0);
    });

    it('server/stats returns cache stats (admin)', async () => {
      const adminToken = process.env.ADMIN_TOKEN;
      if (!adminToken) return;
      const res = await fetch(`${BASE}/server/stats`, { headers: { 'X-Admin-Token': adminToken } });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.status, 'ok');
      const inst = Object.values(data.instances).find(i => i.live);
      assert.ok(inst.cache.lru);
    });
  });

  // ============================================================
  // FUNCTIONS
  // ============================================================
  describe('Functions', () => {
    const adminToken = process.env.ADMIN_TOKEN;

    it('GET /functions returns function catalog (admin)', async () => {
      if (!adminToken) return;
      const res = await fetch(`${BASE}/functions`, { headers: { 'X-Admin-Token': adminToken } });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.ok(data.count > 0);
      assert.ok(Array.isArray(data.functions));
      assert.ok(data.functions[0].name);
    });

    it('GET /functions?names=SUM,AVERAGE filters by name', async () => {
      if (!adminToken) return;
      const res = await fetch(`${BASE}/functions?names=SUM,AVERAGE`, { headers: { 'X-Admin-Token': adminToken } });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.count, 2);
      const names = data.functions.map(f => f.name);
      assert.ok(names.includes('SUM'));
      assert.ok(names.includes('AVERAGE'));
    });

    it('GET /functions/:name returns single function', async () => {
      if (!adminToken) return;
      const res = await fetch(`${BASE}/functions/SUM`, { headers: { 'X-Admin-Token': adminToken } });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.name, 'SUM');
    });

    it('GET /functions/:name 404 for unknown function', async () => {
      if (!adminToken) return;
      const res = await fetch(`${BASE}/functions/NOTAREALFUNCTION`, { headers: { 'X-Admin-Token': adminToken } });
      assert.strictEqual(res.status, 404);
    });

    it('GET /functions requires admin token', async () => {
      const res = await fetch(`${BASE}/functions`);
      assert.strictEqual(res.status, 401);
    });
  });

  // ============================================================
  // LOCALE - SINGLE
  // ============================================================
  describe('Locale - Single Eval', () => {
    // German
    it('de: SUMME(1;2;3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SUMME(1;2;3)', locale: 'de' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    it('de: WENN(1>0;"ja";"nein") = ja', async () => {
      const { status, data } = await post('/execute', { formula: 'WENN(1>0;"ja";"nein")', locale: 'de' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 'ja');
    });

    it('de: MITTELWERT(10;20;30) = 20', async () => {
      const { status, data } = await post('/execute', { formula: 'MITTELWERT(10;20;30)', locale: 'de' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 20);
    });

    // French
    it('fr: SOMME(1;2;3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SOMME(1;2;3)', locale: 'fr' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    it('fr: SI(1>0;"oui";"non") = oui', async () => {
      const { status, data } = await post('/execute', { formula: 'SI(1>0;"oui";"non")', locale: 'fr' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 'oui');
    });

    // Spanish
    it('es: SUMA(1;2;3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SUMA(1;2;3)', locale: 'es' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    // Italian
    it('it: SOMMA(1;2;3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SOMMA(1;2;3)', locale: 'it' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    // Polish
    it('pl: SUMA(1;2;3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SUMA(1;2;3)', locale: 'pl' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    // Dutch
    it('nl: SOM(1;2;3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SOM(1;2;3)', locale: 'nl' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    // Swedish
    it('sv: SUMMA(1;2;3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SUMMA(1;2;3)', locale: 'sv' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    // Danish
    it('da: SUM(1;2;3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SUM(1;2;3)', locale: 'da' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    // Finnish
    it('fi: SUMMA(1;2;3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SUMMA(1;2;3)', locale: 'fi' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    // Norwegian
    it('nb: SUMMER(1;2;3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SUMMER(1;2;3)', locale: 'nb' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    // Portuguese
    it('pt: SOMA(1;2;3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SOMA(1;2;3)', locale: 'pt' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    // Turkish
    it('tr: TOPLA(1;2;3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'TOPLA(1;2;3)', locale: 'tr' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    // Czech
    it('cs: SUMA(1;2;3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SUMA(1;2;3)', locale: 'cs' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    // Russian (uses Latin names with ; separator)
    it('ru: SUM(1;2;3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SUM(1;2;3)', locale: 'ru' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    // English (default) stays on comma separator
    it('en: SUM(1,2,3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SUM(1,2,3)', locale: 'en' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    // No locale defaults to en
    it('no locale: SUM(1,2,3) = 6', async () => {
      const { status, data } = await post('/execute', { formula: 'SUM(1,2,3)' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });
  });

  // ============================================================
  // LOCALE - BATCH
  // ============================================================
  describe('Locale - Batch Eval', () => {
    it('de: batch with German formulas', async () => {
      const { status, data } = await post('/execute/batch', {
        formulas: ['SUMME(1;2;3)', 'MITTELWERT(10;20;30)', 'MAX(1;5;3)'],
        locale: 'de',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 6);
      assert.strictEqual(data.results[1].result, 20);
      assert.strictEqual(data.results[2].result, 5);
    });

    it('fr: batch with French formulas', async () => {
      const { status, data } = await post('/execute/batch', {
        formulas: ['SOMME(1;2;3)', 'MOYENNE(10;20;30)'],
        locale: 'fr',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 6);
      assert.strictEqual(data.results[1].result, 20);
    });

    it('en: batch stays on comma separator', async () => {
      const { status, data } = await post('/execute/batch', {
        formulas: ['SUM(1,2,3)', 'AVERAGE(10,20,30)'],
        locale: 'en',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 6);
      assert.strictEqual(data.results[1].result, 20);
    });
  });

  // ============================================================
  // LOCALE - SHEET
  // ============================================================
  describe('Locale - Sheet Eval', () => {
    it('de: sheet with German formulas', async () => {
      const { status, data } = await post('/execute/sheet', {
        data: [[10, 20], [30, 40]],
        formulas: [{ cell: 'C1', formula: 'SUMME(A1;B1)' }],
        locale: 'de',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0][2], 30);
    });

    it('fr: sheet with French formulas', async () => {
      const { status, data } = await post('/execute/sheet', {
        data: [[100, 200]],
        formulas: [{ cell: 'C1', formula: 'SOMME(A1;B1)' }],
        locale: 'fr',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0][2], 300);
    });
  });

  // ============================================================
  // CACHING
  // ============================================================
  describe('Caching', () => {
    it('second call returns cached=true', async () => {
      const formula = `SUM(${Date.now()},1)`;
      const first = await post('/execute', { formula });
      assert.strictEqual(first.data.cached, false);
      const second = await post('/execute', { formula });
      assert.strictEqual(second.data.cached, true);
      assert.strictEqual(first.data.result, second.data.result);
    });

    it('different locale = different cache key', async () => {
      const ts = Date.now();
      // Same formula text, different locale -> separate cache entries
      const en = await post('/execute', { formula: `SUM(${ts},1)` });
      assert.strictEqual(en.data.cached, false);
      // Second call in en -> cached
      const en2 = await post('/execute', { formula: `SUM(${ts},1)` });
      assert.strictEqual(en2.data.cached, true);
      // Same formula in fr locale -> not cached (different key), also 422 since comma isn't fr separator
      const fr = await post('/execute', { formula: `SUM(${ts},1)`, locale: 'fr' });
      assert.strictEqual(fr.status, 422);
    });

    it('batch caching works', async () => {
      const f = `SUM(${Date.now()},99)`;
      await post('/execute/batch', { formulas: [f] });
      const { data } = await post('/execute/batch', { formulas: [f] });
      assert.strictEqual(data.results[0].cached, true);
    });
  });

  // ============================================================
  // ERROR HANDLING
  // ============================================================
  describe('Errors', () => {
    it('400: missing formula', async () => {
      const { status } = await post('/execute', {});
      assert.strictEqual(status, 400);
    });

    it('400: empty formula', async () => {
      const { status } = await post('/execute', { formula: '' });
      assert.strictEqual(status, 400);
    });

    it('400: formula too long', async () => {
      const { status } = await post('/execute', { formula: 'A'.repeat(10001) });
      assert.strictEqual(status, 400);
    });

    it('400: batch empty array', async () => {
      const { status } = await post('/execute/batch', { formulas: [] });
      assert.strictEqual(status, 400);
    });

    it('400: batch missing formulas', async () => {
      const { status } = await post('/execute/batch', {});
      assert.strictEqual(status, 400);
    });

    it('400: sheet missing data', async () => {
      const { status } = await post('/execute/sheet', { formulas: [] });
      assert.strictEqual(status, 400);
    });

    it('422: division by zero', async () => {
      const { status, data } = await post('/execute', { formula: '1/0' });
      assert.strictEqual(status, 422);
      assert.ok(data.error);
    });

    it('422: unknown function', async () => {
      const { status, data } = await post('/execute', { formula: 'NOTAFUNCTION()' });
      assert.strictEqual(status, 422);
      assert.ok(data.error);
    });
  });

  // ============================================================
  // FINGERPRINT BLOCKING
  // ============================================================
  describe('Fingerprint Blocking', () => {
    const blocked = ['VERSION()', 'ISBINARY("101")', 'COUNTUNIQUE({1,1,2})', 'MAXPOOL({1,2},1,1)', 'MEDIANPOOL({1,2},1,1)', 'ARRAY_CONSTRAIN({1},1,1)', 'ARRAYFORMULA(1+1)', 'INTERVAL(1000)', 'SPLIT("a,b",",")'];
    for (const formula of blocked) {
      it(`blocks ${formula} with NAME error`, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 422);
        assert.strictEqual(data.type, 'NAME');
        assert.strictEqual(data.error, 'Formula error');
      });
    }

    it('blocks in nested formula', async () => {
      const { status, data } = await post('/execute', { formula: 'LEN(VERSION())' });
      assert.strictEqual(status, 422);
      assert.strictEqual(data.type, 'NAME');
    });

    it('blocks in batch', async () => {
      const { status, data } = await post('/execute/batch', {
        formulas: ['SUM(1,2)', 'VERSION()', 'SUM(3,4)'],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 3);
      assert.strictEqual(data.results[1].type, 'NAME');
      assert.strictEqual(data.results[2].result, 7);
    });

    it('blocks in sheet', async () => {
      const { status, data } = await post('/execute/sheet', {
        data: [[1]],
        formulas: [{ cell: 'B1', formula: 'VERSION()' }],
      });
      assert.strictEqual(status, 422);
      assert.strictEqual(data.type, 'NAME');
    });
  });

  // ============================================================
  // OPTIONAL DATA ON /execute AND /execute/batch
  // ============================================================
  describe('Data param', () => {
    it('/execute with data returns correct result', async () => {
      const { status, data } = await post('/execute', {
        formula: 'SUM(A1:B2)',
        data: [[1, 2], [3, 4]],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 10);
      assert.strictEqual(data.format, 'scalar');
    });

    it('/execute with data is never cached', async () => {
      const { data: d1 } = await post('/execute', {
        formula: 'SUM(A1:B1)',
        data: [[100, 200]],
      });
      assert.strictEqual(d1.cached, false);
      const { data: d2 } = await post('/execute', {
        formula: 'SUM(A1:B1)',
        data: [[100, 200]],
      });
      assert.strictEqual(d2.cached, false);
    });

    it('/execute without data is still cached', async () => {
      const formula = `SUM(${Date.now()},42)`;
      await post('/execute', { formula });
      const { data } = await post('/execute', { formula });
      assert.strictEqual(data.cached, true);
    });

    it('/execute with data + locale', async () => {
      const { status, data } = await post('/execute', {
        formula: 'SUMME(A1;B1)',
        data: [[10, 20]],
        locale: 'de',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 30);
    });

    it('/execute with data + spill formula returns full array', async () => {
      const { status, data } = await post('/execute', {
        formula: 'TRANSPOSE(A1:C1)',
        data: [[10, 20, 30]],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.format, 'array');
      assert.deepStrictEqual(data.result, [[10], [20], [30]]);
    });

    it('/execute with data + error returns 422', async () => {
      const { status, data } = await post('/execute', {
        formula: 'A1/B1',
        data: [[1, 0]],
      });
      assert.strictEqual(status, 422);
      assert.strictEqual(data.type, 'DIV_BY_ZERO');
    });

    it('/execute/batch with shared data', async () => {
      const { status, data } = await post('/execute/batch', {
        data: [[100, 200], [300, 400]],
        formulas: ['SUM(A1:B1)', 'SUM(A2:B2)', 'SUM(A1:B2)'],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 300);
      assert.strictEqual(data.results[1].result, 700);
      assert.strictEqual(data.results[2].result, 1000);
      assert.strictEqual(data.results[0].format, 'scalar');
    });

    it('/execute/batch with data has no cache interaction', async () => {
      const { data } = await post('/execute/batch', {
        data: [[1, 2]],
        formulas: ['SUM(A1:B1)'],
      });
      assert.strictEqual(data.results[0].cached, false);
      const { data: d2 } = await post('/execute/batch', {
        data: [[1, 2]],
        formulas: ['SUM(A1:B1)'],
      });
      assert.strictEqual(d2.results[0].cached, false);
    });

    it('/execute/batch with data + blocked formula', async () => {
      const { status, data } = await post('/execute/batch', {
        data: [[1]],
        formulas: ['SUM(A1,1)', 'VERSION()'],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 2);
      assert.strictEqual(data.results[1].type, 'NAME');
    });

    it('/execute with data + blocked formula', async () => {
      const { status, data } = await post('/execute', {
        formula: 'VERSION()',
        data: [[1, 2]],
      });
      assert.strictEqual(status, 422);
      assert.strictEqual(data.type, 'NAME');
    });

    it('/execute/batch with data + locale', async () => {
      const { status, data } = await post('/execute/batch', {
        data: [[10, 20], [30, 40]],
        formulas: ['SUMME(A1;B1)', 'SUMME(A2;B2)'],
        locale: 'de',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 30);
      assert.strictEqual(data.results[1].result, 70);
    });

    it('/execute/batch with data + mixed errors', async () => {
      const { status, data } = await post('/execute/batch', {
        data: [[10, 0], [5, 2]],
        formulas: ['A1+B1', 'A1/B1', 'A2*B2'],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 10);
      assert.strictEqual(data.results[0].format, 'scalar');
      assert.strictEqual(data.results[1].type, 'DIV_BY_ZERO');
      assert.strictEqual(data.results[2].result, 10);
    });

    it('/execute with data + single cell reference', async () => {
      const { status, data } = await post('/execute', {
        formula: 'A1*2',
        data: [[42]],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 84);
    });

    it('/execute with data does not pollute no-data cache', async () => {
      const formula = `SUM(${Date.now()},1)`;
      // First: call with data — skips cache
      const { data: d1 } = await post('/execute', { formula, data: [[100]] });
      assert.strictEqual(d1.cached, false);
      // Second: same formula without data — should NOT be cached from the data call
      const { data: d2 } = await post('/execute', { formula });
      assert.strictEqual(d2.cached, false);
    });
  });

  // ============================================================
  // MULTI-SHEET
  // ============================================================
  describe('Multi-sheet', () => {
    it('cross-sheet formula reference', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: {
          Sales: [[100, 200], [300, 400]],
          Tax: [[0.1], [0.2]],
        },
        formulas: [{ sheet: 'Sales', cell: 'C1', formula: 'A1*Tax!A1' }],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.Sales[0][2], 10);
    });

    it('formula sheet field targets correct sheet', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: {
          S1: [[1, 2]],
          S2: [[10, 20]],
        },
        formulas: [
          { sheet: 'S1', cell: 'C1', formula: 'A1+B1' },
          { sheet: 'S2', cell: 'C1', formula: 'A1+B1' },
        ],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.S1[0][2], 3);
      assert.strictEqual(data.results.S2[0][2], 30);
    });

    it('default sheet (omitted sheet field) = first sheet', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: {
          First: [[5, 10]],
          Second: [[50, 100]],
        },
        formulas: [{ cell: 'C1', formula: 'A1+B1' }],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.First[0][2], 15);
    });

    it('backward compat: data still returns flat array', async () => {
      const { status, data } = await post('/execute/sheet', {
        data: [[1, 2], [3, 4]],
        formulas: [{ cell: 'C1', formula: 'SUM(A1:B2)' }],
      });
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data.results));
      assert.strictEqual(data.results[0][2], 10);
    });

    it('400 when both data and sheets provided', async () => {
      const { status } = await post('/execute/sheet', {
        data: [[1]],
        sheets: { S1: [[1]] },
        formulas: [{ cell: 'B1', formula: 'A1' }],
      });
      assert.strictEqual(status, 400);
    });

    it('400 when neither data nor sheets provided', async () => {
      const { status } = await post('/execute/sheet', {
        formulas: [{ cell: 'A1', formula: '1+1' }],
      });
      assert.strictEqual(status, 400);
    });

    it('non-existent sheet in formula returns error', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: { S1: [[1]] },
        formulas: [{ sheet: 'NoSuchSheet', cell: 'A1', formula: '1+1' }],
      });
      assert.strictEqual(status, 422);
      assert.ok(data.error);
    });

    it('multiple formulas across different sheets', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: {
          A: [[10]],
          B: [[20]],
          C: [[30]],
        },
        formulas: [
          { sheet: 'A', cell: 'B1', formula: 'A1*2' },
          { sheet: 'B', cell: 'B1', formula: 'A1*3' },
          { sheet: 'C', cell: 'B1', formula: 'A1*4' },
        ],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.A[0][1], 20);
      assert.strictEqual(data.results.B[0][1], 60);
      assert.strictEqual(data.results.C[0][1], 120);
    });

    it('locale with multi-sheet', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: {
          Daten: [[10, 20]],
          Steuer: [[0.19]],
        },
        formulas: [{ sheet: 'Daten', cell: 'C1', formula: 'SUMME(A1;B1)*Steuer!A1' }],
        locale: 'de',
      });
      assert.strictEqual(status, 200);
      assert.ok(Math.abs(data.results.Daten[0][2] - 5.7) < 0.001);
    });

    it('multi-sheet response keyed by sheet name', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: { Alpha: [[1]], Beta: [[2]] },
        formulas: [],
      });
      assert.strictEqual(status, 200);
      assert.ok('Alpha' in data.results);
      assert.ok('Beta' in data.results);
    });

    it('cross-sheet SUM reference', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: {
          Data: [[1, 2], [3, 4]],
          Summary: [[]],
        },
        formulas: [{ sheet: 'Summary', cell: 'A1', formula: 'SUM(Data!A1:B2)' }],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.Summary[0][0], 10);
    });
  });

  // ============================================================
  // EDGE CASES
  // ============================================================
  describe('Edge Cases', () => {
    it('= prefix works', async () => {
      const { data } = await post('/execute', { formula: '=SUM(1,2)' });
      assert.strictEqual(data.result, 3);
    });

    it('nested formulas', async () => {
      const { data } = await post('/execute', { formula: 'ROUND(SQRT(ABS(SUM(-1,-3,-5,-7))),2)' });
      assert.strictEqual(data.result, 4);
    });

    it('100 formulas in batch', async () => {
      const formulas = Array.from({ length: 100 }, (_, i) => `SUM(${i},1)`);
      const { status, data } = await post('/execute/batch', { formulas });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.length, 100);
      assert.strictEqual(data.results[0].result, 1);
      assert.strictEqual(data.results[99].result, 100);
    });

    it('sheet with complex refs', async () => {
      const { data } = await post('/execute/sheet', {
        data: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
        formulas: [
          { cell: 'D1', formula: 'SUM(A1:C3)' },
          { cell: 'D2', formula: 'AVERAGE(A1:C3)' },
          { cell: 'D3', formula: 'MAX(A1:C3)' },
        ],
      });
      assert.strictEqual(data.results[0][3], 45);
      assert.strictEqual(data.results[1][3], 5);
      assert.strictEqual(data.results[2][3], 9);
    });
  });
});

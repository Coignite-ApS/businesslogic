import { checkAdminToken } from '../utils/auth.js';

let bl = null;

async function loadBl() {
  if (!bl) {
    bl = await import('@coignite/businesslogic-excel');
  }
  return bl;
}

export async function registerRoutes(app) {
  // GET /functions — full catalog or filtered
  app.get('/functions', async (req, reply) => {
    const authErr = checkAdminToken(req);
    if (authErr) return reply.code(authErr.code).send(authErr.body);

    const { category, names, search } = req.query;

    try {
      const engine = await loadBl();
      const namesList = names ? names.split(',').map(n => n.trim()) : null;
      const result = engine.getFunctionDocs(namesList, category || null, false, search || null);
      return result;
    } catch (err) {
      req.log.error(err, 'Function docs failed');
      return reply.code(500).send({ error: 'Function docs not available' });
    }
  });

  // GET /functions/:name — single function detail
  app.get('/functions/:name', async (req, reply) => {
    const authErr = checkAdminToken(req);
    if (authErr) return reply.code(authErr.code).send(authErr.body);

    const { name } = req.params;

    try {
      const engine = await loadBl();
      const result = engine.getFunctionDocs([name.toUpperCase()]);
      if (result.count === 0) {
        return reply.code(404).send({ error: `Function "${name}" not found` });
      }
      return result.functions[0];
    } catch (err) {
      req.log.error(err, 'Function docs failed');
      return reply.code(500).send({ error: 'Function docs not available' });
    }
  });
}

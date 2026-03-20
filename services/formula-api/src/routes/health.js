import { config } from '../config.js';
import { checkAdminToken } from '../utils/auth.js';
import { collectSnapshot, getAllSnapshots } from '../services/health-push.js';

export async function registerRoutes(app) {
  app.get('/ping', async () => ({ status: 'ok' }));

  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

  app.get('/server/stats', async (req, reply) => {
    const authErr = checkAdminToken(req);
    if (authErr) return reply.code(authErr.code).send(authErr.body);

    // This instance: always live
    const live = await collectSnapshot();
    live.live = true;

    // Other instances from Redis
    const allSnapshots = await getAllSnapshots();

    // Merge: overwrite own entry with live data
    const instances = {};
    for (const [id, snap] of Object.entries(allSnapshots)) {
      if (id === config.instanceId) continue;
      instances[id] = { ...snap, live: false };
    }
    instances[config.instanceId] = live;

    // Cluster aggregate
    const cluster = {
      instances: Object.keys(instances).length,
      totalWorkers: 0,
      totalQueuePending: 0,
      totalQueueMax: 0,
      totalCalculators: 0,
      totalHeapUsedMB: 0,
      totalHeapTotalMB: 0,
    };

    for (const snap of Object.values(instances)) {
      cluster.totalWorkers += snap.capacity?.totalWorkers || snap.poolSize || 0;
      cluster.totalQueuePending += snap.queue?.pending || 0;
      cluster.totalQueueMax += snap.queue?.max || 0;
      cluster.totalCalculators += snap.calculators?.size || 0;
      cluster.totalHeapUsedMB += snap.capacity?.totalHeapUsedMB || 0;
      cluster.totalHeapTotalMB += snap.capacity?.totalHeapTotalMB || 0;
    }
    cluster.totalHeapUsedMB = Math.round(cluster.totalHeapUsedMB * 10) / 10;
    cluster.totalHeapTotalMB = Math.round(cluster.totalHeapTotalMB * 10) / 10;

    return {
      status: 'ok',
      ts: Date.now(),
      instanceId: config.instanceId,
      cluster,
      instances,
    };
  });
}

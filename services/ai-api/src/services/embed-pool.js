import { Worker } from 'node:worker_threads';
import { config } from '../config.js';

const WORKER_URL = new URL('./embed-worker.js', import.meta.url);
const EMBED_TIMEOUT_MS = parseInt(process.env.EMBED_TIMEOUT_MS || '60000', 10);
const MAX_BATCH_SIZE = 256;

let pool = null;

class EmbedPool {
  constructor(size) {
    this.size = size;
    this.workers = new Array(size);
    this.pending = new Array(size);
    this.idx = 0;
    this.msgId = 0;
    this.pendingTotal = 0;
    this.maxPending = parseInt(process.env.MAX_EMBED_QUEUE_DEPTH || '0', 10) || size * 64;
    this._destroyed = false;
    this._init();
  }

  get pendingCount() {
    return this.pendingTotal;
  }

  _init() {
    for (let i = 0; i < this.size; i++) {
      this._spawnWorker(i);
    }
  }

  _spawnWorker(index) {
    const worker = new Worker(WORKER_URL, {
      workerData: {
        openaiApiKey: config.openaiApiKey,
        embeddingModel: config.embeddingModel,
      },
    });
    const pendingMap = new Map();

    worker.on('message', (msg) => {
      const p = pendingMap.get(msg.id);
      if (!p) return;
      this.pendingTotal--;
      pendingMap.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        p.reject(new Error(msg.error));
      } else {
        p.resolve(msg.result);
      }
    });

    worker.on('error', (err) => {
      this.pendingTotal -= pendingMap.size;
      for (const [, p] of pendingMap) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      pendingMap.clear();
    });

    worker.on('exit', (code) => {
      this.pendingTotal -= pendingMap.size;
      for (const [, p] of pendingMap) {
        clearTimeout(p.timer);
        p.reject(new Error(`Worker stopped (code ${code})`));
      }
      pendingMap.clear();
      if (!this._destroyed) {
        this._spawnWorker(index);
      }
    });

    this.workers[index] = worker;
    this.pending[index] = pendingMap;
  }

  dispatch(texts) {
    if (this._destroyed) return Promise.reject(new Error('Pool destroyed'));

    if (this.pendingTotal >= this.maxPending) {
      const err = new Error('Queue full');
      err.statusCode = 503;
      return Promise.reject(err);
    }

    // Split into batches of MAX_BATCH_SIZE and dispatch across workers
    if (texts.length <= MAX_BATCH_SIZE) {
      return this._dispatchSingle(texts);
    }

    const batches = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      batches.push(texts.slice(i, i + MAX_BATCH_SIZE));
    }
    return Promise.all(batches.map(b => this._dispatchSingle(b)))
      .then(results => results.flat());
  }

  _dispatchSingle(texts) {
    const i = this.idx++ % this.size;
    const id = this.msgId++;
    const worker = this.workers[i];
    const pendingMap = this.pending[i];

    this.pendingTotal++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingTotal--;
        pendingMap.delete(id);
        reject(new Error('Worker timeout'));
      }, EMBED_TIMEOUT_MS);

      pendingMap.set(id, { resolve, reject, timer });
      worker.postMessage({ id, type: 'embed', texts });
    });
  }

  destroy() {
    this._destroyed = true;
    for (let i = 0; i < this.size; i++) {
      const pendingMap = this.pending[i];
      this.pendingTotal -= pendingMap.size;
      for (const [, p] of pendingMap) {
        clearTimeout(p.timer);
        p.reject(new Error('Pool destroyed'));
      }
      pendingMap.clear();
      this.workers[i].terminate();
    }
  }
}

export function initEmbedPool() {
  if (pool) return pool;
  pool = new EmbedPool(config.embedPoolSize);
  return pool;
}

export function closeEmbedPool() {
  if (pool) {
    pool.destroy();
    pool = null;
  }
}

export function dispatchEmbed(texts) {
  if (!pool) throw new Error('Embed pool not initialized');
  return pool.dispatch(texts);
}

export function getEmbedPool() {
  return pool;
}

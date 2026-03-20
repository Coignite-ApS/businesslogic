import { Worker } from 'node:worker_threads';
import { config } from '../config.js';

function workerUrlFor(engine) {
  const file = engine === 'bl-excel' ? 'engine-worker-bl.js' : 'engine-worker.js';
  return new URL(`./${file}`, import.meta.url);
}

class EnginePool {
  constructor(size, engine = 'hyperformula') {
    this._workerUrl = workerUrlFor(engine);
    this.size = size;
    this.workers = new Array(size);
    this.pending = new Array(size);
    this.idx = 0;
    this.msgId = 0;
    this.pendingTotal = 0;
    this.maxPending = config.maxQueueDepth || size * 64;
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
    const worker = new Worker(this._workerUrl);
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

    // error is always fatal and always followed by exit —
    // reject pending here, let exit handle respawn
    worker.on('error', (err) => {
      this.pendingTotal -= pendingMap.size;
      for (const [, p] of pendingMap) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      pendingMap.clear();
    });

    // exit fires after error (crash) or after terminate() (shutdown)
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

  _dispatch(payload) {
    if (this._destroyed) return Promise.reject(new Error('Pool destroyed'));

    if (this.pendingTotal >= this.maxPending) {
      const err = new Error('Queue full');
      err.statusCode = 503;
      return Promise.reject(err);
    }

    const i = this.idx++ % this.size;
    return this._dispatchTo(i, payload);
  }

  _dispatchTo(workerIndex, payload) {
    if (this._destroyed) return Promise.reject(new Error('Pool destroyed'));

    if (this.pendingTotal >= this.maxPending) {
      const err = new Error('Queue full');
      err.statusCode = 503;
      return Promise.reject(err);
    }

    const id = this.msgId++;
    const worker = this.workers[workerIndex];
    const pendingMap = this.pending[workerIndex];

    this.pendingTotal++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingTotal--;
        pendingMap.delete(id);
        reject(new Error('Worker timeout'));
      }, config.requestTimeout);

      pendingMap.set(id, { resolve, reject, timer });
      worker.postMessage({ id, ...payload });
    });
  }

  evalSingle(formula, locale) {
    return this._dispatch({ type: 'evalSingle', formula, locale });
  }

  evalBatch(formulas, locale) {
    return this._dispatch({ type: 'evalBatch', formulas, locale });
  }

  evalSingleWithData(formula, data, locale, expressions) {
    return this._dispatch({ type: 'evalSingleWithData', formula, data, locale, expressions });
  }

  evalBatchWithData(formulas, data, locale, expressions) {
    return this._dispatch({ type: 'evalBatchWithData', formulas, data, locale, expressions });
  }

  evalSheet(data, formulas, locale, expressions) {
    return this._dispatch({ type: 'evalSheet', data, formulas, locale, expressions });
  }

  evalMultiSheet(sheets, formulas, locale, expressions) {
    return this._dispatch({ type: 'evalMultiSheet', sheets, formulas, locale, expressions });
  }

  createCalculator(calculatorId, sheets, formulas, locale, inputMappings, outputScalars, outputRanges, expressions) {
    const workerIndex = this.idx++ % this.size;
    return this._dispatchTo(workerIndex, {
      type: 'createCalculator', calculatorId, sheets, formulas, locale,
      inputMappings, outputScalars, outputRanges, expressions,
    }).then(result => ({
      workerIndex,
      profile: result.profile,
      unresolvedFunctions: result.unresolvedFunctions,
    }));
  }

  calculate(calculatorId, workerIndex, values) {
    return this._dispatchTo(workerIndex, { type: 'calculate', calculatorId, values });
  }

  destroyCalculator(calculatorId, workerIndex) {
    return this._dispatchTo(workerIndex, { type: 'destroyCalculator', calculatorId });
  }

  getWorkerStats() {
    const promises = [];
    for (let i = 0; i < this.size; i++) {
      promises.push(
        this._dispatchTo(i, { type: 'getStats' }).catch(() => null),
      );
    }
    return Promise.all(promises);
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

// ── A/B Testing Pool ─────────────────────────────────────────────────────────
// ENGINE=both: run HF (primary) + bl-excel (shadow) in parallel, compare, log.

const FP_TOLERANCE = 1e-10;

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    if (a === 0 && b === 0) return true;
    return Math.abs(a - b) <= FP_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual(a[k], b[k]));
}

class ABPool {
  constructor(size) {
    this.primary = new EnginePool(size, 'hyperformula');
    this.shadow = new EnginePool(size, 'bl-excel');
    this.discrepancies = 0;
    this.comparisons = 0;
  }

  get pendingCount() {
    return this.primary.pendingCount;
  }

  _compare(label, primaryResult, shadowResult, meta) {
    this.comparisons++;
    if (!deepEqual(primaryResult, shadowResult)) {
      this.discrepancies++;
      console.warn('[ab-test] discrepancy in %s: %j', label, {
        ...meta,
        hf: typeof primaryResult === 'object' ? JSON.stringify(primaryResult).slice(0, 200) : primaryResult,
        bl: typeof shadowResult === 'object' ? JSON.stringify(shadowResult).slice(0, 200) : shadowResult,
      });
    }
  }

  async _run(method, args, label, meta) {
    const [primary, shadow] = await Promise.allSettled([
      this.primary[method](...args),
      this.shadow[method](...args),
    ]);
    if (primary.status === 'rejected') throw primary.reason;
    if (shadow.status === 'fulfilled') {
      this._compare(label, primary.value, shadow.value, meta);
    }
    return primary.value;
  }

  evalSingle(formula, locale) {
    return this._run('evalSingle', [formula, locale], 'evalSingle', { formula, locale });
  }

  evalBatch(formulas, locale) {
    return this._run('evalBatch', [formulas, locale], 'evalBatch', { count: formulas.length, locale });
  }

  evalSingleWithData(formula, data, locale, expressions) {
    return this._run('evalSingleWithData', [formula, data, locale, expressions], 'evalSingleWithData', { formula, locale });
  }

  evalBatchWithData(formulas, data, locale, expressions) {
    return this._run('evalBatchWithData', [formulas, data, locale, expressions], 'evalBatchWithData', { count: formulas.length, locale });
  }

  evalSheet(data, formulas, locale, expressions) {
    return this._run('evalSheet', [data, formulas, locale, expressions], 'evalSheet', { formulaCount: formulas.length, locale });
  }

  evalMultiSheet(sheets, formulas, locale, expressions) {
    return this._run('evalMultiSheet', [sheets, formulas, locale, expressions], 'evalMultiSheet', { sheets: Object.keys(sheets), locale });
  }

  async createCalculator(calculatorId, sheets, formulas, locale, inputMappings, outputScalars, outputRanges, expressions) {
    const [primary, shadow] = await Promise.allSettled([
      this.primary.createCalculator(calculatorId, sheets, formulas, locale, inputMappings, outputScalars, outputRanges, expressions),
      this.shadow.createCalculator(calculatorId, sheets, formulas, locale, inputMappings, outputScalars, outputRanges, expressions),
    ]);
    if (primary.status === 'rejected') throw primary.reason;
    return primary.value;
  }

  async calculate(calculatorId, workerIndex, values) {
    const [primary, shadow] = await Promise.allSettled([
      this.primary.calculate(calculatorId, workerIndex, values),
      this.shadow.calculate(calculatorId, workerIndex, values),
    ]);
    if (primary.status === 'rejected') throw primary.reason;
    if (shadow.status === 'fulfilled') {
      this._compare('calculate', primary.value, shadow.value, { calculatorId });
    }
    return primary.value;
  }

  async destroyCalculator(calculatorId, workerIndex) {
    const [primary] = await Promise.allSettled([
      this.primary.destroyCalculator(calculatorId, workerIndex),
      this.shadow.destroyCalculator(calculatorId, workerIndex),
    ]);
    if (primary.status === 'rejected') throw primary.reason;
    return primary.value;
  }

  getWorkerStats() {
    return this.primary.getWorkerStats();
  }

  destroy() {
    this.primary.destroy();
    this.shadow.destroy();
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

export const pool = config.engine === 'both'
  ? new ABPool(config.poolSize)
  : new EnginePool(config.poolSize, config.engine);

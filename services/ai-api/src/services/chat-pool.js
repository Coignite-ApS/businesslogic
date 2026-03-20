import { Worker } from 'node:worker_threads';
import { config } from '../config.js';

const WORKER_URL = new URL('./chat-worker.js', import.meta.url);

let pool = null;

class ChatPool {
  constructor(size) {
    this.size = size;
    this.workers = new Array(size);
    this.pending = new Array(size);
    this.idx = 0;
    this.msgId = 0;
    this.pendingTotal = 0;
    this.maxPending = parseInt(process.env.MAX_CHAT_QUEUE_DEPTH || '0', 10) || size * 32;
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
        anthropicApiKey: config.anthropicApiKey,
        defaultModel: config.defaultModel,
        maxOutputTokens: config.maxOutputTokens,
      },
    });
    const pendingMap = new Map();

    worker.on('message', (msg) => {
      const p = pendingMap.get(msg.id);
      if (!p) return;

      // Streaming chunks don't resolve — only final/error do
      if (msg.type === 'chunk') {
        if (p.onChunk) p.onChunk(msg.data);
        return;
      }

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

  dispatch(payload, onChunk) {
    if (this._destroyed) return Promise.reject(new Error('Pool destroyed'));

    if (this.pendingTotal >= this.maxPending) {
      const err = new Error('Queue full');
      err.statusCode = 503;
      return Promise.reject(err);
    }

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
      }, config.chatTimeoutMs);

      pendingMap.set(id, { resolve, reject, timer, onChunk });
      worker.postMessage({ id, ...payload });
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

export function initChatPool() {
  if (pool) return pool;
  pool = new ChatPool(config.chatPoolSize);
  return pool;
}

export function closeChatPool() {
  if (pool) {
    pool.destroy();
    pool = null;
  }
}

export function dispatchChat(payload, onChunk) {
  if (!pool) throw new Error('Chat pool not initialized');
  return pool.dispatch(payload, onChunk);
}

export function getChatPool() {
  return pool;
}

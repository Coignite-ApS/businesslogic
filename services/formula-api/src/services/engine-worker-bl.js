import { parentPort } from 'node:worker_threads';
import blExcel from '@coignite/businesslogic-excel';
import { resolveLocale } from '../config.js';

const calculatorMeta = new Map();

parentPort.on('message', (msg) => {
  const { id, type } = msg;
  try {
    let result;
    switch (type) {
      case 'evalSingle':
        result = blExcel.evalSingle(msg.formula, msg.locale || undefined);
        break;
      case 'evalBatch':
        result = blExcel.evalBatch(msg.formulas, msg.locale || undefined);
        break;
      case 'evalSingleWithData':
        result = blExcel.evalSingleWithData(msg.formula, msg.data, msg.locale || undefined, msg.expressions || undefined);
        break;
      case 'evalBatchWithData':
        result = blExcel.evalBatchWithData(msg.formulas, msg.data, msg.locale || undefined, msg.expressions || undefined);
        break;
      case 'evalSheet': {
        const loc = resolveLocale(msg.locale);
        const raw = blExcel.evalSheet({ Sheet1: msg.data }, msg.formulas, loc, msg.expressions || undefined);
        result = raw?.Sheet1 ?? raw;
        break;
      }
      case 'evalMultiSheet': {
        const loc = resolveLocale(msg.locale);
        result = blExcel.evalSheet(msg.sheets, msg.formulas, loc, msg.expressions || undefined);
        break;
      }
      case 'createCalculator': {
        const sheetsSize = JSON.stringify(msg.sheets).length;
        const formulasSize = JSON.stringify(msg.formulas).length;
        const expressionsSize = msg.expressions ? JSON.stringify(msg.expressions).length : 0;
        const rssBefore = process.memoryUsage().rss;
        result = blExcel.createCalculator(
          msg.calculatorId, msg.sheets, msg.formulas,
          msg.expressions || undefined, msg.locale || undefined,
          msg.inputMappings, msg.outputScalars, msg.outputRanges,
        );
        if (result?.profile) {
          const rssDelta = process.memoryUsage().rss - rssBefore;
          result.profile.heapDeltaMB = Math.round(rssDelta / 1048576 * 10) / 10;
          const rustBytes = blExcel.calculatorMemory(msg.calculatorId);
          if (rustBytes != null) {
            result.profile.rustMemoryMB = Math.round(rustBytes / 1048576 * 100) / 100;
            result.profile.rustMemoryBytes = rustBytes;
          }
        }
        calculatorMeta.set(msg.calculatorId, {
          locale: msg.locale || null,
          dataBytes: sheetsSize + formulasSize + expressionsSize,
          lastUsed: Date.now(),
        });
        break;
      }
      case 'calculate': {
        result = blExcel.calculate(msg.calculatorId, msg.values);
        const meta = calculatorMeta.get(msg.calculatorId);
        if (meta) meta.lastUsed = Date.now();
        break;
      }
      case 'destroyCalculator':
        result = blExcel.destroyCalculator(msg.calculatorId);
        calculatorMeta.delete(msg.calculatorId);
        break;
      case 'getStats': {
        const calcs = [];
        const now = Date.now();
        for (const [cid, meta] of calculatorMeta) {
          const rustBytes = blExcel.calculatorMemory(cid);
          calcs.push({
            id: cid,
            locale: meta.locale,
            dataBytes: meta.dataBytes,
            rustBytes,
            idleMs: now - meta.lastUsed,
          });
        }
        result = { calculators: calcs, memory: process.memoryUsage() };
        break;
      }
      default:
        parentPort.postMessage({ id, error: `Unknown type: ${type}` });
        return;
    }
    parentPort.postMessage({ id, result });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});

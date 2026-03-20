import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('telemetry module', () => {
  it('exports initTelemetry and shutdownTelemetry', async () => {
    const mod = await import('../src/telemetry.js');
    assert.equal(typeof mod.initTelemetry, 'function');
    assert.equal(typeof mod.shutdownTelemetry, 'function');
  });

  it('initTelemetry is a no-op when OTEL_ENABLED is not set', async () => {
    // Ensure env vars are not set (default test environment)
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    const { initTelemetry, shutdownTelemetry } = await import('../src/telemetry.js');

    // Should not throw
    initTelemetry();
    await shutdownTelemetry();
  });

  it('shutdownTelemetry resolves cleanly when not initialized', async () => {
    const { shutdownTelemetry } = await import('../src/telemetry.js');
    await assert.doesNotReject(() => shutdownTelemetry());
  });
});

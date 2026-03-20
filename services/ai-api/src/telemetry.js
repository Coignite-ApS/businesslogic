/**
 * OpenTelemetry instrumentation for bl-ai-api.
 *
 * Must be imported BEFORE any other modules (auto-instrumentation patches on load).
 * Exports traces and metrics via OTLP to the collector.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { config } from './config.js';

const enabled = process.env.OTEL_ENABLED === 'true' || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

let sdk;

export function initTelemetry() {
  if (!enabled) return;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: 'bl-ai-api',
    [ATTR_SERVICE_VERSION]: config.version,
    'service.instance.id': config.instanceId,
  });

  sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: 15000,
    }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) =>
          req.url === '/ping' || req.url === '/health',
      }),
    ],
  });

  sdk.start();
  console.log(`[otel] tracing enabled → ${endpoint}`);
}

export async function shutdownTelemetry() {
  if (sdk) {
    await sdk.shutdown();
  }
}

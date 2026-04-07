// src/tracing.ts — Optional OpenTelemetry tracing for Honeycomb.
// Import this file first in index.ts so the SDK is initialized before anything runs.
// When OTEL_EXPORTER_OTLP_ENDPOINT is unset, everything is a no-op.

import { trace, context, type Tracer, type Context, SpanStatusCode, type Span } from "@opentelemetry/api";

const ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (ENDPOINT) {
  // Dynamic imports keep the SDK out of the module graph when tracing is off.
  const { BasicTracerProvider, BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-base");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { ATTR_SERVICE_NAME } = await import("@opentelemetry/semantic-conventions");

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "hearthstone-backend",
  });

  // Parse OTEL_EXPORTER_OTLP_HEADERS ("key=val,key2=val2") into a record.
  const rawHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS || "";
  const headers: Record<string, string> = {};
  for (const pair of rawHeaders.split(",")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx > 0) {
      headers[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
    }
  }

  const exporter = new OTLPTraceExporter({
    url: `${ENDPOINT}/v1/traces`,
    headers,
  });

  const provider = new BasicTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);

  console.log(`OpenTelemetry tracing enabled -> ${ENDPOINT}`);
}

/** Shared tracer instance. Returns a noop tracer when the SDK isn't configured. */
export const tracer: Tracer = trace.getTracer("hearthstone-backend");

export { SpanStatusCode, context };
export type { Span, Context };

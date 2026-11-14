import type { IncomingMessage } from "node:http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

// Docker healthchecks poll /health every few seconds. Tracing those
// requests floods Jaeger with automatic GET traces, so skip them.
function isHealthCheck(request: IncomingMessage): boolean {
  const url = request.url ?? "";
  return url === "/health" || url.startsWith("/health?");
}

const traceExporter = new OTLPTraceExporter({
  url:
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    "http://localhost:4318/v1/traces",
});

const metricExporter = new OTLPMetricExporter({
  url:
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ??
    "http://localhost:4318/v1/metrics",
});

const sdk = new NodeSDK({
  traceExporter,
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 10000,
    }),
  ],
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-http": {
        ignoreIncomingRequestHook: isHealthCheck,
      },
    }),
  ],
});

sdk.start();

console.log("OpenTelemetry tracing and metrics initialized");

process.on("SIGTERM", () => {
  void sdk.shutdown();
});

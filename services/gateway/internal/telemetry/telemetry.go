// Package telemetry provides OpenTelemetry trace and metric initialization for bl-gateway.
package telemetry

import (
	"context"
	"os"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	sdkresource "go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Init configures the global TracerProvider with an OTLP HTTP exporter.
// Returns a shutdown function that must be called on exit.
// If OTEL_EXPORTER_OTLP_ENDPOINT is not set, tracing is a no-op.
func Init(ctx context.Context) func(context.Context) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" && os.Getenv("OTEL_ENABLED") != "true" {
		return func(context.Context) {}
	}

	opts := []otlptracehttp.Option{
		otlptracehttp.WithInsecure(),
	}
	if endpoint != "" {
		opts = append(opts, otlptracehttp.WithEndpoint(endpoint))
	}

	exporter, err := otlptracehttp.New(ctx, opts...)
	if err != nil {
		log.Warn().Err(err).Msg("failed to create OTLP exporter, tracing disabled")
		return func(context.Context) {}
	}

	res, _ := sdkresource.New(ctx,
		sdkresource.WithAttributes(
			semconv.ServiceName("bl-gateway"),
			semconv.ServiceVersion("0.1.0"),
		),
	)

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter, sdktrace.WithBatchTimeout(5*time.Second)),
		sdktrace.WithResource(res),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	log.Info().Str("endpoint", endpoint).Msg("[otel] tracing enabled")

	return func(ctx context.Context) {
		_ = tp.Shutdown(ctx)
	}
}

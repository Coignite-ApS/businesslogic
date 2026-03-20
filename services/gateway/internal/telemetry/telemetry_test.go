package telemetry

import (
	"context"
	"os"
	"testing"
)

func TestInit_NoopWhenDisabled(t *testing.T) {
	os.Unsetenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	os.Unsetenv("OTEL_ENABLED")

	shutdown := Init(context.Background())
	// Should be a no-op function that doesn't panic
	shutdown(context.Background())
}

func TestInit_ReturnsShutdownFunc(t *testing.T) {
	shutdown := Init(context.Background())
	if shutdown == nil {
		t.Fatal("Init returned nil, expected a function")
	}
}

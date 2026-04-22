package config

import (
	"os"
	"strings"
	"testing"
)

func TestValidate_MissingGatewaySharedSecret(t *testing.T) {
	cfg := &Config{
		GatewaySharedSecret: "",
	}
	os.Setenv("SKIP_SECRET_VALIDATION", "")
	defer os.Unsetenv("SKIP_SECRET_VALIDATION")

	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected error for missing GATEWAY_SHARED_SECRET")
	}
	if got := err.Error(); !strings.Contains(got, "GATEWAY_SHARED_SECRET") {
		t.Errorf("error should mention GATEWAY_SHARED_SECRET, got: %s", got)
	}
}

func TestValidate_AllSecretsPresent(t *testing.T) {
	cfg := &Config{
		GatewaySharedSecret: "test-secret",
	}

	err := cfg.Validate()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidate_SkipSecretValidation(t *testing.T) {
	cfg := &Config{
		GatewaySharedSecret: "",
	}
	os.Setenv("SKIP_SECRET_VALIDATION", "true")
	defer os.Unsetenv("SKIP_SECRET_VALIDATION")

	err := cfg.Validate()
	if err != nil {
		t.Fatalf("expected no error with SKIP_SECRET_VALIDATION=true, got: %v", err)
	}
}

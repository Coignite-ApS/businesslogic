package config

import (
	"os"
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
	if got := err.Error(); !contains(got, "GATEWAY_SHARED_SECRET") {
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

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsImpl(s, substr))
}

func containsImpl(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

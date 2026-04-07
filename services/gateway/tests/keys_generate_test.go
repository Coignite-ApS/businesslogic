package tests

import (
	"strings"
	"testing"

	"github.com/coignite-aps/bl-gateway/internal/service"
)

func TestGenerateKey_Format(t *testing.T) {
	gk, err := service.GenerateKey()
	if err != nil {
		t.Fatal("GenerateKey failed:", err)
	}

	if !strings.HasPrefix(gk.RawKey, "bl_") {
		t.Errorf("raw key should start with bl_, got %s", gk.RawKey[:5])
	}
	if len(gk.RawKey) != 67 {
		t.Errorf("expected raw key length 67, got %d", len(gk.RawKey))
	}
	if len(gk.KeyHash) != 64 {
		t.Errorf("expected key hash length 64, got %d", len(gk.KeyHash))
	}
	if len(gk.KeyPrefix) != 11 {
		t.Errorf("expected key prefix length 11, got %d", len(gk.KeyPrefix))
	}
	if gk.KeyPrefix != gk.RawKey[:11] {
		t.Errorf("prefix should be first 11 chars of raw key")
	}
}

func TestGenerateKey_Unique(t *testing.T) {
	gk1, _ := service.GenerateKey()
	gk2, _ := service.GenerateKey()
	if gk1.RawKey == gk2.RawKey {
		t.Error("two generated keys should not be identical")
	}
	if gk1.KeyHash == gk2.KeyHash {
		t.Error("two generated key hashes should not be identical")
	}
}

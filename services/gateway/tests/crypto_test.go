package tests

import (
	"os"
	"strings"
	"testing"

	"github.com/coignite-aps/bl-gateway/internal/service"
)

const testEncryptionKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func setTestKey(t *testing.T) {
	t.Helper()
	os.Setenv("KEY_ENCRYPTION_KEY", testEncryptionKey)
	t.Cleanup(func() { os.Unsetenv("KEY_ENCRYPTION_KEY") })
}

func TestEncryptDecrypt_RoundTrip(t *testing.T) {
	setTestKey(t)

	plaintext := "bl_dGVzdGtleXRoYXRpc2xvbmdlbm91Z2h0b2JlYXJlYWxhcGlrZXk"
	encrypted, err := service.Encrypt(plaintext)
	if err != nil {
		t.Fatal("Encrypt failed:", err)
	}

	if !strings.HasPrefix(encrypted, "v1:") {
		t.Errorf("encrypted should start with v1:, got %s", encrypted[:10])
	}

	parts := strings.SplitN(encrypted, ":", 3)
	if len(parts) != 3 {
		t.Fatalf("expected 3 parts (v1:iv:ct), got %d", len(parts))
	}

	decrypted, err := service.Decrypt(encrypted)
	if err != nil {
		t.Fatal("Decrypt failed:", err)
	}

	if decrypted != plaintext {
		t.Errorf("round-trip mismatch: got %q, want %q", decrypted, plaintext)
	}
}

func TestEncryptDecrypt_DifferentCiphertexts(t *testing.T) {
	setTestKey(t)

	plaintext := "bl_samekey"
	enc1, _ := service.Encrypt(plaintext)
	enc2, _ := service.Encrypt(plaintext)

	if enc1 == enc2 {
		t.Error("two encryptions of same plaintext should differ (random IV)")
	}

	// Both should still decrypt correctly
	dec1, _ := service.Decrypt(enc1)
	dec2, _ := service.Decrypt(enc2)
	if dec1 != plaintext || dec2 != plaintext {
		t.Error("both ciphertexts should decrypt to original plaintext")
	}
}

func TestDecrypt_WrongKey(t *testing.T) {
	setTestKey(t)

	plaintext := "bl_secretkey123"
	encrypted, err := service.Encrypt(plaintext)
	if err != nil {
		t.Fatal("Encrypt failed:", err)
	}

	// Change to a different key
	os.Setenv("KEY_ENCRYPTION_KEY", "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789")

	_, err = service.Decrypt(encrypted)
	if err == nil {
		t.Error("Decrypt with wrong key should fail")
	}
}

func TestDecrypt_TamperedCiphertext(t *testing.T) {
	setTestKey(t)

	plaintext := "bl_secretkey456"
	encrypted, err := service.Encrypt(plaintext)
	if err != nil {
		t.Fatal("Encrypt failed:", err)
	}

	// Tamper with the ciphertext portion
	parts := strings.SplitN(encrypted, ":", 3)
	tampered := parts[0] + ":" + parts[1] + ":" + "AAAA" + parts[2][4:]

	_, err = service.Decrypt(tampered)
	if err == nil {
		t.Error("Decrypt with tampered ciphertext should fail")
	}
}

func TestEncrypt_NoKeySet(t *testing.T) {
	os.Unsetenv("KEY_ENCRYPTION_KEY")

	_, err := service.Encrypt("test")
	if err == nil {
		t.Error("Encrypt without KEY_ENCRYPTION_KEY should fail")
	}
}

func TestDecrypt_InvalidFormat(t *testing.T) {
	setTestKey(t)

	_, err := service.Decrypt("not-valid-format")
	if err == nil {
		t.Error("Decrypt with invalid format should fail")
	}

	_, err = service.Decrypt("v2:something:else")
	if err == nil {
		t.Error("Decrypt with wrong version should fail")
	}
}

func TestEncryptionKeyAvailable(t *testing.T) {
	os.Unsetenv("KEY_ENCRYPTION_KEY")
	if service.EncryptionKeyAvailable() {
		t.Error("should be false when key not set")
	}

	os.Setenv("KEY_ENCRYPTION_KEY", testEncryptionKey)
	t.Cleanup(func() { os.Unsetenv("KEY_ENCRYPTION_KEY") })
	if !service.EncryptionKeyAvailable() {
		t.Error("should be true when key is set")
	}
}

func TestEncrypt_InvalidKeyLength(t *testing.T) {
	os.Setenv("KEY_ENCRYPTION_KEY", "tooshort")
	t.Cleanup(func() { os.Unsetenv("KEY_ENCRYPTION_KEY") })

	_, err := service.Encrypt("test")
	if err == nil {
		t.Error("Encrypt with short key should fail")
	}
}

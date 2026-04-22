package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
)

// Encrypt encrypts plaintext using AES-256-GCM. Returns "v1:iv:ciphertext" (base64).
// The GCM tag is appended to the ciphertext by Go's crypto/cipher (standard behavior).
// Returns empty string if KEY_ENCRYPTION_KEY is not set (graceful degradation).
func Encrypt(plaintext string) (string, error) {
	key, err := loadEncryptionKey()
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("cipher init: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("gcm init: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("nonce generation: %w", err)
	}

	// Seal appends ciphertext+tag to nonce slice, but we want them separate
	ciphertext := gcm.Seal(nil, nonce, []byte(plaintext), nil)

	iv := base64.RawStdEncoding.EncodeToString(nonce)
	ct := base64.RawStdEncoding.EncodeToString(ciphertext)

	return fmt.Sprintf("v1:%s:%s", iv, ct), nil
}

// Decrypt reverses Encrypt. Expects "v1:iv:ciphertext" format.
func Decrypt(encrypted string) (string, error) {
	key, err := loadEncryptionKey()
	if err != nil {
		return "", err
	}

	parts := strings.SplitN(encrypted, ":", 3)
	if len(parts) != 3 || parts[0] != "v1" {
		return "", fmt.Errorf("invalid encrypted format")
	}

	nonce, err := base64.RawStdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("decode iv: %w", err)
	}

	ciphertext, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("cipher init: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("gcm init: %w", err)
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt failed: %w", err)
	}

	return string(plaintext), nil
}

// EncryptionKeyAvailable returns true if KEY_ENCRYPTION_KEY is configured.
func EncryptionKeyAvailable() bool {
	return os.Getenv("KEY_ENCRYPTION_KEY") != ""
}

// loadEncryptionKey reads and validates KEY_ENCRYPTION_KEY from env.
func loadEncryptionKey() ([]byte, error) {
	hexKey := os.Getenv("KEY_ENCRYPTION_KEY")
	if hexKey == "" {
		return nil, fmt.Errorf("KEY_ENCRYPTION_KEY not set")
	}
	if len(hexKey) != 64 {
		return nil, fmt.Errorf("KEY_ENCRYPTION_KEY must be 64 hex chars (32 bytes)")
	}
	key, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("KEY_ENCRYPTION_KEY invalid hex: %w", err)
	}
	return key, nil
}

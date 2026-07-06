//go:build darwin

package keyvault

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"serverpilot/internal/secretstore"
)

type memorySecretStore struct {
	values map[string][]byte
}

func newMemorySecretStore() *memorySecretStore {
	return &memorySecretStore{values: map[string][]byte{}}
}

func (s *memorySecretStore) Get(_ context.Context, key string) ([]byte, error) {
	value, ok := s.values[key]
	if !ok {
		return nil, secretstore.ErrNotFound
	}
	return append([]byte(nil), value...), nil
}

func (s *memorySecretStore) Set(_ context.Context, key string, value []byte) error {
	s.values[key] = append([]byte(nil), value...)
	return nil
}

func (s *memorySecretStore) Delete(_ context.Context, key string) error {
	delete(s.values, key)
	return nil
}

func TestDarwinProtectorProtectsAndUnprotectsAfterRestart(t *testing.T) {
	secrets := newMemorySecretStore()
	first := NewDarwinProtector(secrets)
	plaintext := []byte("fixture private key material")
	protected, err := first.Protect(plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(protected, plaintext) {
		t.Fatal("protected blob contains plaintext private key material")
	}
	if !IsLocalProtectorBlob(protected) {
		limit := len(protected)
		if limit > len(LocalProtectorBlobPrefix) {
			limit = len(LocalProtectorBlobPrefix)
		}
		t.Fatalf("protected blob missing local prefix: %q", protected[:limit])
	}

	second := NewDarwinProtector(secrets)
	got, err := second.Unprotect(protected)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("got %q, want %q", got, plaintext)
	}
}

func TestDarwinProtectorRejectsForeignBlobWithoutLeakingSecret(t *testing.T) {
	protector := NewDarwinProtector(newMemorySecretStore())
	foreign := []byte("windows-dpapi-private-key-secret-marker")
	_, err := protector.Unprotect(foreign)
	if err == nil {
		t.Fatal("foreign blob was accepted")
	}
	if !strings.Contains(err.Error(), WindowsProtectedCredentialHint) {
		t.Fatalf("error = %q", err)
	}
	if strings.Contains(err.Error(), "secret-marker") {
		t.Fatalf("error leaked protected material: %q", err)
	}
}

func TestDarwinProtectorRejectsInvalidMasterKey(t *testing.T) {
	secrets := newMemorySecretStore()
	if err := secrets.Set(context.Background(), darwinMasterKeyReference, []byte("short")); err != nil {
		t.Fatal(err)
	}
	_, err := NewDarwinProtector(secrets).Protect([]byte("key"))
	if err == nil {
		t.Fatal("invalid master key was accepted")
	}
	if errors.Is(err, secretstore.ErrNotFound) {
		t.Fatalf("error should be sanitized, got %v", err)
	}
}

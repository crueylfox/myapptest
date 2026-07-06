//go:build darwin

package keyvault

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"

	"golang.org/x/crypto/chacha20poly1305"

	"serverpilot/internal/secretstore"
)

const darwinMasterKeyReference = "ServerPilot/keyvault/master-key"

type DarwinProtector struct {
	secrets secretstore.Store
}

func NewPlatformProtector() KeyMaterialProtector {
	return NewDarwinProtector(secretstore.New())
}

func NewDarwinProtector(secrets secretstore.Store) KeyMaterialProtector {
	if secrets == nil {
		secrets = secretstore.New()
	}
	return DarwinProtector{secrets: secrets}
}

func (p DarwinProtector) Protect(plaintext []byte) ([]byte, error) {
	if len(plaintext) == 0 {
		return nil, errors.New("private key material is empty")
	}
	key, err := p.masterKey()
	if err != nil {
		return nil, err
	}
	defer wipe(key)
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, chacha20poly1305.NonceSizeX)
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("generate private key nonce: %w", err)
	}
	out := make([]byte, 0, len(LocalProtectorBlobPrefix)+len(nonce)+len(plaintext)+aead.Overhead())
	out = append(out, LocalProtectorBlobPrefix...)
	out = append(out, nonce...)
	out = aead.Seal(out, nonce, plaintext, nil)
	return out, nil
}

func (p DarwinProtector) Unprotect(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) == 0 {
		return nil, errors.New("protected private key material is empty")
	}
	if !IsLocalProtectorBlob(ciphertext) {
		return nil, errors.New(WindowsProtectedCredentialHint)
	}
	key, err := p.masterKey()
	if err != nil {
		return nil, err
	}
	defer wipe(key)
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, err
	}
	body := ciphertext[len(LocalProtectorBlobPrefix):]
	if len(body) <= chacha20poly1305.NonceSizeX {
		return nil, errors.New("macOS private key material is invalid")
	}
	nonce := body[:chacha20poly1305.NonceSizeX]
	sealed := body[chacha20poly1305.NonceSizeX:]
	plaintext, err := aead.Open(nil, nonce, sealed, nil)
	if err != nil {
		return nil, errors.New("macOS private key material cannot be decrypted")
	}
	return plaintext, nil
}

func (p DarwinProtector) masterKey() ([]byte, error) {
	if p.secrets == nil {
		return nil, errors.New("macOS Keychain is unavailable")
	}
	key, err := p.secrets.Get(context.Background(), darwinMasterKeyReference)
	if err == nil {
		if len(key) != chacha20poly1305.KeySize {
			wipe(key)
			return nil, errors.New("macOS key vault master key is invalid")
		}
		return key, nil
	}
	if !errors.Is(err, secretstore.ErrNotFound) {
		return nil, errors.New("macOS key vault master key is unavailable")
	}
	key = make([]byte, chacha20poly1305.KeySize)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generate macOS key vault master key: %w", err)
	}
	if err := p.secrets.Set(context.Background(), darwinMasterKeyReference, key); err != nil {
		wipe(key)
		return nil, errors.New("macOS key vault master key could not be saved to Keychain")
	}
	return key, nil
}

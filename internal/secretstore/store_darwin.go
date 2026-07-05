//go:build darwin

package secretstore

import (
	"context"
	"errors"
)

// Keychain is the macOS platform boundary. Native Keychain calls will replace
// the explicit unsupported result when macOS build verification is available.
type Keychain struct{}

func newPlatformStore() Store {
	return Keychain{}
}

func (Keychain) Get(context.Context, string) ([]byte, error) {
	return nil, ErrNotFound
}

func (Keychain) Set(context.Context, string, []byte) error {
	return errors.New("macOS Keychain storage is not implemented in this Windows build")
}

func (Keychain) Delete(context.Context, string) error {
	return nil
}

//go:build !windows && !darwin

package keyvault

import "errors"

type unsupportedProtector struct{}

func NewPlatformProtector() KeyMaterialProtector {
	return unsupportedProtector{}
}

func (unsupportedProtector) Protect([]byte) ([]byte, error) {
	return nil, errors.New("private key protection is not implemented on this platform")
}

func (unsupportedProtector) Unprotect([]byte) ([]byte, error) {
	return nil, errors.New("private key protection is not implemented on this platform")
}

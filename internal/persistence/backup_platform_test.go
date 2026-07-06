package persistence

import (
	"testing"

	"serverpilot/internal/keyvault"
)

func TestProtectedKeyBlobRestorableForPlatform(t *testing.T) {
	if protectedKeyBlobRestorableForPlatform("darwin", []byte("windows-dpapi-blob")) {
		t.Fatal("darwin must not treat unversioned Windows DPAPI blobs as restorable")
	}
	if !protectedKeyBlobRestorableForPlatform("darwin", []byte(keyvault.LocalProtectorBlobPrefix+"ciphertext")) {
		t.Fatal("darwin should accept local protector blobs")
	}
	if !protectedKeyBlobRestorableForPlatform("windows", []byte("windows-dpapi-blob")) {
		t.Fatal("windows import behavior must continue to accept existing DPAPI blobs")
	}
}

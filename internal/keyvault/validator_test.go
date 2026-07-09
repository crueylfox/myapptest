package keyvault

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"

	"hostdeck/internal/domain"
)

type fakeProtector struct{}

func (fakeProtector) Protect(plaintext []byte) ([]byte, error) {
	out := append([]byte("protected:"), plaintext...)
	for index := len("protected:"); index < len(out); index++ {
		out[index] ^= 0x5a
	}
	return out, nil
}

func (fakeProtector) Unprotect(ciphertext []byte) ([]byte, error) {
	out := append([]byte(nil), ciphertext[len("protected:"):]...)
	for index := range out {
		out[index] ^= 0x5a
	}
	return out, nil
}

func TestValidateUnencryptedPrivateKey(t *testing.T) {
	path := writePrivateKey(t, false, "")
	result := ValidatePrivateKeyFile(domain.ValidatePrivateKeyFileRequest{PrivateKeyPath: path})
	if !result.Valid || result.Encrypted || result.Algorithm != ssh.KeyAlgoED25519 || result.FingerprintSHA256 == "" || result.KeyBits != 256 {
		t.Fatalf("result = %+v", result)
	}
}

func TestValidateEncryptedPrivateKey(t *testing.T) {
	testValue := "test-value-" + t.Name()
	path := writePrivateKey(t, true, testValue)
	needsPassphrase := ValidatePrivateKeyFile(domain.ValidatePrivateKeyFileRequest{PrivateKeyPath: path})
	if needsPassphrase.Valid || !needsPassphrase.Encrypted || needsPassphrase.ErrorCode != CodePassphraseNeeded {
		t.Fatalf("needsPassphrase = %+v", needsPassphrase)
	}
	wrong := ValidatePrivateKeyFile(domain.ValidatePrivateKeyFileRequest{
		PrivateKeyPath: path,
		Passphrase:     testValue + "-wrong",
	})
	if wrong.Valid || wrong.ErrorCode != CodePassphraseWrong {
		t.Fatalf("wrong = %+v", wrong)
	}
	valid := ValidatePrivateKeyFile(domain.ValidatePrivateKeyFileRequest{
		PrivateKeyPath: path,
		Passphrase:     testValue,
	})
	if !valid.Valid || !valid.Encrypted || valid.Algorithm != ssh.KeyAlgoED25519 {
		t.Fatalf("valid = %+v", valid)
	}
}

func TestValidateEncryptedPrivateKeyDoesNotEchoPassphrase(t *testing.T) {
	passphrase := "fixture-passphrase-that-must-not-be-rendered"
	path := writePrivateKey(t, true, passphrase)
	result := ValidatePrivateKeyFile(domain.ValidatePrivateKeyFileRequest{
		PrivateKeyPath: path,
		Passphrase:     passphrase + "-wrong",
	})
	serialized := strings.Join([]string{
		result.ErrorCode,
		result.UserMessage,
		result.TechnicalMessage,
	}, "\n")
	for _, forbidden := range []string{passphrase, passphrase + "-wrong"} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("validation error leaked passphrase material %q in %q", forbidden, serialized)
		}
	}
}

func TestValidateMissingPrivateKeyFile(t *testing.T) {
	result := ValidatePrivateKeyFile(domain.ValidatePrivateKeyFileRequest{
		PrivateKeyPath: filepath.Join(t.TempDir(), "missing"),
	})
	if result.Valid || result.ErrorCode != CodeFileUnavailable {
		t.Fatalf("result = %+v", result)
	}
}

func TestImportPrivateKeyProtectsMaterial(t *testing.T) {
	path := writePrivateKey(t, false, "")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	result, err := ImportPrivateKeyFromFile(domain.SaveKeyVaultEntryRequest{
		PrivateKeyPath: path,
	}, fakeProtector{})
	if err != nil {
		t.Fatal(err)
	}
	if result.SourceFileName != filepath.Base(path) {
		t.Fatalf("source filename = %q", result.SourceFileName)
	}
	if !result.Validation.Valid || result.Validation.FingerprintSHA256 == "" {
		t.Fatalf("validation = %+v", result.Validation)
	}
	if bytes.Equal(result.ProtectedBlob, raw) {
		t.Fatal("protected blob equals raw private key bytes")
	}
	for _, marker := range [][]byte{
		[]byte("BEGIN OPENSSH PRIVATE KEY"),
		[]byte("BEGIN RSA PRIVATE KEY"),
		[]byte("BEGIN PRIVATE KEY"),
		[]byte("BEGIN EC PRIVATE KEY"),
	} {
		if bytes.Contains(result.ProtectedBlob, marker) {
			t.Fatalf("protected blob contains PEM marker %q", marker)
		}
	}
	unprotected, err := fakeProtector{}.Unprotect(result.ProtectedBlob)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(unprotected, raw) {
		t.Fatal("unprotected key does not match original")
	}
}

func TestValidateRejectsOversizedPrivateKeyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "too-large")
	if err := os.WriteFile(path, bytes.Repeat([]byte("x"), MaxPrivateKeyBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	result := ValidatePrivateKeyFile(domain.ValidatePrivateKeyFileRequest{PrivateKeyPath: path})
	if result.Valid || result.ErrorCode != CodeFileTooLarge {
		t.Fatalf("result = %+v", result)
	}
}

func writePrivateKey(t *testing.T, encrypted bool, passphrase string) string {
	t.Helper()
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	var block *pem.Block
	if encrypted {
		block, err = ssh.MarshalPrivateKeyWithPassphrase(privateKey, "", []byte(passphrase))
	} else {
		block, err = ssh.MarshalPrivateKey(privateKey, "")
	}
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "id_ed25519")
	if err := os.WriteFile(path, pem.EncodeToMemory(block), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

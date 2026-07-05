package sshclient

import (
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"fmt"
	"testing"

	"golang.org/x/crypto/ssh"

	"serverpilot/internal/connectionerror"
	"serverpilot/internal/domain"
)

func testPublicKey(t *testing.T) ssh.PublicKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	publicKey, err := ssh.NewPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	return publicKey
}

func TestTrustedHostKeyIsAcceptedWithoutTrustPrompt(t *testing.T) {
	key := testPublicKey(t)
	fingerprint := ssh.FingerprintSHA256(key)
	var observed string
	callback := verifyHostKey(domain.Connection{
		HostKeyFingerprint: fingerprint,
	}, false, false, &observed)
	if err := callback("", nil, key); err != nil {
		t.Fatal(err)
	}
	if observed != fingerprint {
		t.Fatalf("observed=%q", observed)
	}
}

func TestChangedHostKeyReportsOldAndNewFingerprint(t *testing.T) {
	key := testPublicKey(t)
	received := ssh.FingerprintSHA256(key)
	const saved = "SHA256:saved-fingerprint"
	var observed string
	callback := verifyHostKey(domain.Connection{
		HostKeyFingerprint: saved,
	}, false, false, &observed)
	err := callback("", nil, key)
	var changed *HostKeyChangedError
	if !errors.As(err, &changed) {
		t.Fatalf("expected HostKeyChangedError, got %v", err)
	}
	if changed.Expected != saved || changed.Observed != received {
		t.Fatalf("changed=%+v", changed)
	}
	if changed.Error() == "" || observed != received {
		t.Fatalf("message=%q observed=%q", changed.Error(), observed)
	}
}

func TestChangedHostKeyCanBeAcceptedWhenPolicyAllowsUpdate(t *testing.T) {
	key := testPublicKey(t)
	received := ssh.FingerprintSHA256(key)
	var observed string
	callback := verifyHostKey(domain.Connection{
		HostKeyFingerprint: "SHA256:saved-fingerprint",
	}, false, true, &observed)
	if err := callback("", nil, key); err != nil {
		t.Fatalf("changed host key should be accepted when trustChanged=true: %v", err)
	}
	if observed != received {
		t.Fatalf("observed=%q want %q", observed, received)
	}
}

func TestUnknownHostRequiresExplicitTrust(t *testing.T) {
	key := testPublicKey(t)
	var observed string
	callback := verifyHostKey(domain.Connection{}, false, false, &observed)
	if err := callback("", nil, key); !errors.Is(err, ErrUnknownHostKey) {
		t.Fatalf("expected unknown host error, got %v", err)
	}
	callback = verifyHostKey(domain.Connection{}, true, false, &observed)
	if err := callback("", nil, key); err != nil {
		t.Fatal(err)
	}
}

func TestApplyHostKeyPolicy(t *testing.T) {
	connection := domain.Connection{}
	auth := ApplyHostKeyPolicy(domain.HostKeyAutoUpdate, connection, domain.AuthRequest{})
	if !auth.TrustUnknownHost || !auth.TrustChangedHost || !auth.PersistHostKey {
		t.Fatalf("auto-update did not enable trust and persistence: %+v", auth)
	}
	trusted := domain.Connection{HostKeyFingerprint: "SHA256:saved"}
	auth = ApplyHostKeyPolicy(domain.HostKeyAutoUpdate, trusted, domain.AuthRequest{})
	if !auth.TrustUnknownHost || !auth.TrustChangedHost || !auth.PersistHostKey {
		t.Fatalf("auto-update should also allow changed saved fingerprints: %+v", auth)
	}
	auth = ApplyHostKeyPolicy(domain.HostKeyStrict, connection, domain.AuthRequest{
		TrustUnknownHost: true,
		TrustChangedHost: true,
		PersistHostKey:   true,
	})
	if auth.TrustUnknownHost || auth.TrustChangedHost || auth.PersistHostKey {
		t.Fatalf("strict policy accepted automatic trust: %+v", auth)
	}
	auth = ApplyHostKeyPolicy(domain.HostKeyAsk, connection, domain.AuthRequest{})
	if !auth.TrustUnknownHost || !auth.TrustChangedHost || !auth.PersistHostKey {
		t.Fatalf("legacy policies should migrate to auto-update behavior: %+v", auth)
	}
}

func TestShouldPersistObservedHostKey(t *testing.T) {
	connection := domain.Connection{HostKeyFingerprint: "SHA256:saved"}
	if ShouldPersistObservedHostKey(connection, domain.AuthRequest{PersistHostKey: true}, "") {
		t.Fatal("empty observed fingerprint should not be persisted")
	}
	if ShouldPersistObservedHostKey(connection, domain.AuthRequest{PersistHostKey: false}, "SHA256:new") {
		t.Fatal("non-persistent auth should not persist host key")
	}
	if ShouldPersistObservedHostKey(connection, domain.AuthRequest{PersistHostKey: true}, "SHA256:saved") {
		t.Fatal("unchanged fingerprint should not be persisted")
	}
	if !ShouldPersistObservedHostKey(connection, domain.AuthRequest{PersistHostKey: true}, "SHA256:new") {
		t.Fatal("changed fingerprint should be persisted when policy allows")
	}
}

func TestStructuredConnectionErrorPreservesChangedFingerprints(t *testing.T) {
	err := fmt.Errorf("SSH handshake failed: %w", &HostKeyChangedError{
		Expected: "SHA256:old",
		Observed: "SHA256:new",
	})
	result := connectionerror.Classify(err, domain.Connection{ID: 1}, "connection.test")
	if result.Code != connectionerror.CodeHostKeyMismatch {
		t.Fatalf("code = %q", result.Code)
	}
	if result.ExpectedFingerprint != "SHA256:old" || result.ObservedFingerprint != "SHA256:new" {
		t.Fatalf("fingerprints were not preserved: %+v", result)
	}
}

func TestStructuredConnectionErrorClassifiesRejectedSavedCredential(t *testing.T) {
	result := connectionerror.Classify(
		errors.New("ssh: unable to authenticate, attempted methods [password]"),
		domain.Connection{ID: 1, AuthType: domain.AuthPassword},
		"connection.test",
	)
	if result.Code != connectionerror.CodeAuthFailed {
		t.Fatalf("code = %q", result.Code)
	}
	if result.UserMessage == result.TechnicalMessage {
		t.Fatalf("technical error leaked into user message: %+v", result)
	}
}

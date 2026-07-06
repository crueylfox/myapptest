//go:build darwin

package secretstore

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"testing"
)

func TestDarwinKeychainRoundTripUsesBase64GenericPassword(t *testing.T) {
	commands := make([][]string, 0)
	encoded := ""
	store := NewKeychainWithRunner(func(_ context.Context, command string, args ...string) ([]byte, error) {
		commands = append(commands, append([]string{command}, args...))
		switch command {
		case "add-generic-password":
			encoded = args[len(args)-1]
			return nil, nil
		case "find-generic-password":
			return []byte(encoded + "\n"), nil
		case "delete-generic-password":
			return nil, nil
		default:
			t.Fatalf("unexpected security command: %s %v", command, args)
			return nil, nil
		}
	})

	want := []byte{0x00, 0x01, 0x02, 0xff}
	if err := store.Set(context.Background(), "ServerPilot/test", want); err != nil {
		t.Fatal(err)
	}
	if encoded != base64.StdEncoding.EncodeToString(want) {
		t.Fatalf("stored value was not base64 encoded: %q", encoded)
	}
	got, err := store.Get(context.Background(), "ServerPilot/test")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if err := store.Delete(context.Background(), "ServerPilot/test"); err != nil {
		t.Fatal(err)
	}
	if len(commands) != 3 {
		t.Fatalf("commands=%v", commands)
	}
}

func TestDarwinKeychainNotFoundMapsToErrNotFound(t *testing.T) {
	store := NewKeychainWithRunner(func(context.Context, string, ...string) ([]byte, error) {
		return []byte("The specified item could not be found in the keychain."), errors.New("exit status 44")
	})
	if _, err := store.Get(context.Background(), "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get error = %v", err)
	}
	if err := store.Delete(context.Background(), "missing"); err != nil {
		t.Fatalf("Delete missing = %v", err)
	}
}

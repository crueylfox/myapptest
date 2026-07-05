//go:build windows

package secretstore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"
)

func TestWindowsCredentialManagerRoundTrip(t *testing.T) {
	store := WindowsCredentialManager{}
	key := fmt.Sprintf("ServerPilot/test/%d/%d", os.Getpid(), time.Now().UnixNano())
	ctx := context.Background()
	defer store.Delete(ctx, key)

	want := []byte("temporary-test-secret")
	if err := store.Set(ctx, key, want); err != nil {
		t.Fatal(err)
	}
	got, err := store.Get(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
	if err := store.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(ctx, key); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

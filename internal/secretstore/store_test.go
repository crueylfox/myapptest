package secretstore

import (
	"context"
	"errors"
	"testing"
)

func TestRuntimeOnlyNeverPersists(t *testing.T) {
	store := RuntimeOnly{}
	if err := store.Set(context.Background(), "test", []byte("secret")); err == nil {
		t.Fatal("runtime-only store must reject durable writes")
	}
	if _, err := store.Get(context.Background(), "test"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get error = %v", err)
	}
	if err := store.Delete(context.Background(), "test"); err != nil {
		t.Fatal(err)
	}
}

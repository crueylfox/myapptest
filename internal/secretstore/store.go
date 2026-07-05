package secretstore

import (
	"context"
	"errors"
)

var ErrNotFound = errors.New("secret not found")

type Store interface {
	Get(ctx context.Context, key string) ([]byte, error)
	Set(ctx context.Context, key string, value []byte) error
	Delete(ctx context.Context, key string) error
}

func New() Store {
	return newPlatformStore()
}

// RuntimeOnly deliberately provides no durable credential persistence.
type RuntimeOnly struct{}

func (RuntimeOnly) Get(context.Context, string) ([]byte, error) {
	return nil, ErrNotFound
}

func (RuntimeOnly) Set(context.Context, string, []byte) error {
	return errors.New("durable secret storage is not implemented")
}

func (RuntimeOnly) Delete(context.Context, string) error {
	return nil
}

//go:build darwin

package secretstore

import (
	"context"
	"encoding/base64"
	"os/exec"
	"strings"
)

const darwinKeychainService = "HostDeck"

var legacyDarwinKeychainService = "Server" + "Pilot"

type keychainCommandRunner func(context.Context, string, ...string) ([]byte, error)

// Keychain stores HostDeck secrets as generic passwords in macOS Keychain.
type Keychain struct {
	run keychainCommandRunner
}

func newPlatformStore() Store {
	return Keychain{run: runSecurityCommand}
}

func NewKeychainWithRunner(run keychainCommandRunner) Store {
	if run == nil {
		run = runSecurityCommand
	}
	return Keychain{run: run}
}

func (k Keychain) Get(ctx context.Context, key string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	value, err := k.getFromService(ctx, darwinKeychainService, key)
	if err == nil {
		return value, nil
	}
	if !errorsIsNotFound(err) {
		return nil, err
	}
	value, err = k.getFromService(ctx, legacyDarwinKeychainService, key)
	if err != nil {
		return nil, err
	}
	_ = k.Set(ctx, key, value)
	return value, nil
}

func (k Keychain) getFromService(ctx context.Context, service string, key string) ([]byte, error) {
	out, err := k.runner()(ctx, "find-generic-password", "-s", service, "-a", key, "-w")
	if err != nil {
		if keychainNotFound(out, err) {
			return nil, ErrNotFound
		}
		return nil, keychainError("read")
	}
	encoded := strings.TrimSpace(string(out))
	value, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, keychainError("decode")
	}
	return value, nil
}

func (k Keychain) Set(ctx context.Context, key string, value []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	encoded := base64.StdEncoding.EncodeToString(value)
	_, err := k.runner()(ctx, "add-generic-password", "-U", "-s", darwinKeychainService, "-a", key, "-w", encoded)
	if err != nil {
		return keychainError("write")
	}
	return nil
}

func (k Keychain) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	out, err := k.runner()(ctx, "delete-generic-password", "-s", darwinKeychainService, "-a", key)
	if err != nil && !keychainNotFound(out, err) {
		return keychainError("delete")
	}
	out, err = k.runner()(ctx, "delete-generic-password", "-s", legacyDarwinKeychainService, "-a", key)
	if err != nil && !keychainNotFound(out, err) {
		return keychainError("delete")
	}
	return nil
}

func errorsIsNotFound(err error) bool {
	return err == ErrNotFound
}

func (k Keychain) runner() keychainCommandRunner {
	if k.run != nil {
		return k.run
	}
	return runSecurityCommand
}

func runSecurityCommand(ctx context.Context, command string, args ...string) ([]byte, error) {
	cmdArgs := append([]string{command}, args...)
	cmd := exec.CommandContext(ctx, "/usr/bin/security", cmdArgs...)
	return cmd.CombinedOutput()
}

func keychainNotFound(output []byte, _ error) bool {
	lower := strings.ToLower(string(output))
	return strings.Contains(lower, "could not be found") ||
		strings.Contains(lower, "the specified item could not be found") ||
		strings.Contains(lower, "not found")
}

func keychainError(operation string) error {
	return &Error{Message: "macOS Keychain " + operation + " failed"}
}

type Error struct {
	Message string
}

func (e *Error) Error() string {
	return e.Message
}

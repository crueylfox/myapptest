//go:build windows

package secretstore

import (
	"context"
	"errors"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	credentialTypeGeneric         = 1
	credentialPersistLocalMachine = 2
)

var (
	advapi32        = windows.NewLazySystemDLL("advapi32.dll")
	procCredReadW   = advapi32.NewProc("CredReadW")
	procCredWriteW  = advapi32.NewProc("CredWriteW")
	procCredDeleteW = advapi32.NewProc("CredDeleteW")
	procCredFree    = advapi32.NewProc("CredFree")
)

type windowsCredential struct {
	Flags              uint32
	Type               uint32
	TargetName         *uint16
	Comment            *uint16
	LastWritten        windows.Filetime
	CredentialBlobSize uint32
	CredentialBlob     *byte
	Persist            uint32
	AttributeCount     uint32
	Attributes         uintptr
	TargetAlias        *uint16
	UserName           *uint16
}

type WindowsCredentialManager struct{}

func newPlatformStore() Store {
	return WindowsCredentialManager{}
}

func (WindowsCredentialManager) Get(ctx context.Context, key string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	target, err := windows.UTF16PtrFromString(key)
	if err != nil {
		return nil, err
	}
	var credential *windowsCredential
	result, _, callErr := procCredReadW.Call(
		uintptr(unsafe.Pointer(target)),
		credentialTypeGeneric,
		0,
		uintptr(unsafe.Pointer(&credential)),
	)
	runtime.KeepAlive(target)
	if result == 0 {
		if errors.Is(callErr, syscall.Errno(windows.ERROR_NOT_FOUND)) {
			return nil, ErrNotFound
		}
		return nil, callErr
	}
	defer procCredFree.Call(uintptr(unsafe.Pointer(credential)))
	if credential.CredentialBlobSize == 0 {
		return []byte{}, nil
	}
	value := make([]byte, credential.CredentialBlobSize)
	copy(value, unsafe.Slice(credential.CredentialBlob, credential.CredentialBlobSize))
	return value, nil
}

func (WindowsCredentialManager) Set(ctx context.Context, key string, value []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	target, err := windows.UTF16PtrFromString(key)
	if err != nil {
		return err
	}
	username, err := windows.UTF16PtrFromString("ServerPilot")
	if err != nil {
		return err
	}
	credential := windowsCredential{
		Type: credentialTypeGeneric, TargetName: target,
		CredentialBlobSize: uint32(len(value)), Persist: credentialPersistLocalMachine,
		UserName: username,
	}
	if len(value) > 0 {
		credential.CredentialBlob = &value[0]
	}
	result, _, callErr := procCredWriteW.Call(uintptr(unsafe.Pointer(&credential)), 0)
	runtime.KeepAlive(target)
	runtime.KeepAlive(username)
	runtime.KeepAlive(value)
	if result == 0 {
		return callErr
	}
	return nil
}

func (WindowsCredentialManager) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	target, err := windows.UTF16PtrFromString(key)
	if err != nil {
		return err
	}
	result, _, callErr := procCredDeleteW.Call(uintptr(unsafe.Pointer(target)), credentialTypeGeneric, 0)
	runtime.KeepAlive(target)
	if result == 0 && !errors.Is(callErr, syscall.Errno(windows.ERROR_NOT_FOUND)) {
		return callErr
	}
	return nil
}

//go:build windows

package keyvault

import (
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

const cryptProtectUIForbidden = 0x1

type DPAPIProtector struct{}

func NewPlatformProtector() KeyMaterialProtector {
	return DPAPIProtector{}
}

func (DPAPIProtector) Protect(plaintext []byte) ([]byte, error) {
	if len(plaintext) == 0 {
		return nil, errors.New("private key material is empty")
	}
	in := windows.DataBlob{Size: uint32(len(plaintext)), Data: &plaintext[0]}
	var out windows.DataBlob
	name, _ := windows.UTF16PtrFromString("ServerPilot private key")
	err := windows.CryptProtectData(&in, name, nil, 0, nil, cryptProtectUIForbidden, &out)
	if err != nil {
		return nil, err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return blobBytes(out), nil
}

func (DPAPIProtector) Unprotect(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) == 0 {
		return nil, errors.New("protected private key material is empty")
	}
	in := windows.DataBlob{Size: uint32(len(ciphertext)), Data: &ciphertext[0]}
	var out windows.DataBlob
	var name *uint16
	err := windows.CryptUnprotectData(&in, &name, nil, 0, nil, cryptProtectUIForbidden, &out)
	if name != nil {
		windows.LocalFree(windows.Handle(unsafe.Pointer(name)))
	}
	if err != nil {
		return nil, errors.New("无法解密密钥，请确认当前 Windows 用户与导入密钥时一致")
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return blobBytes(out), nil
}

func blobBytes(blob windows.DataBlob) []byte {
	if blob.Size == 0 || blob.Data == nil {
		return []byte{}
	}
	out := make([]byte, blob.Size)
	copy(out, unsafe.Slice(blob.Data, blob.Size))
	return out
}

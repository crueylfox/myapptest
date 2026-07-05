//go:build windows

package localfiles

import (
	"fmt"
	"os"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

type OSShellExecutor struct{}

var (
	shell32           = syscall.NewLazyDLL("shell32.dll")
	procShellExecuteW = shell32.NewProc("ShellExecuteW")
)

func (OSShellExecutor) Open(path string) error {
	return shellExecute("open", path, "")
}

func (OSShellExecutor) Reveal(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return shellExecute("open", "explorer.exe", path)
	}
	return shellExecute("open", "explorer.exe", `/select,"`+strings.ReplaceAll(path, `"`, "")+`"`)
}

func (OSShellExecutor) Properties(path string) error {
	return shellExecute("properties", path, "")
}

func shellExecute(verb, file, params string) error {
	verbPtr, err := windows.UTF16PtrFromString(verb)
	if err != nil {
		return err
	}
	filePtr, err := windows.UTF16PtrFromString(file)
	if err != nil {
		return err
	}
	paramsPtr, err := windows.UTF16PtrFromString(params)
	if err != nil {
		return err
	}
	ret, _, callErr := procShellExecuteW.Call(
		0,
		uintptr(unsafe.Pointer(verbPtr)),
		uintptr(unsafe.Pointer(filePtr)),
		uintptr(unsafe.Pointer(paramsPtr)),
		0,
		1,
	)
	if ret <= 32 {
		if callErr != syscall.Errno(0) {
			return callErr
		}
		return fmt.Errorf("shell execute failed with code %d", ret)
	}
	return nil
}

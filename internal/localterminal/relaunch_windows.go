//go:build windows

package localterminal

import (
	"fmt"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

var shell32 = windows.NewLazySystemDLL("shell32.dll")
var procShellExecute = shell32.NewProc("ShellExecuteW")

func RelaunchElevated(executable string, args []string) error {
	if strings.TrimSpace(executable) == "" {
		return fmt.Errorf("本地终端管理员模式重启失败：应用路径为空")
	}
	verb, err := windows.UTF16PtrFromString("runas")
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString(executable)
	if err != nil {
		return err
	}
	params, err := windows.UTF16PtrFromString(strings.Join(args, " "))
	if err != nil {
		return err
	}
	result, _, callErr := procShellExecute.Call(
		0,
		uintptr(unsafePointer(verb)),
		uintptr(unsafePointer(file)),
		uintptr(unsafePointer(params)),
		0,
		1,
	)
	if result <= 32 {
		if callErr != windows.ERROR_SUCCESS {
			return fmt.Errorf("本地终端管理员模式重启失败：%w", callErr)
		}
		return fmt.Errorf("本地终端管理员模式重启失败：ShellExecuteW 返回 %d", result)
	}
	return nil
}

func unsafePointer(value *uint16) uintptr {
	return uintptr(unsafe.Pointer(value))
}

//go:build windows

package localterminal

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

const embeddedPTYCreationFlags = windows.CREATE_NEW_PROCESS_GROUP
const windowsStillActive = 259
const windowsWaitTimeout = 258

var (
	kernel32                              = windows.NewLazySystemDLL("kernel32.dll")
	procCreatePseudoConsole               = kernel32.NewProc("CreatePseudoConsole")
	procResizePseudoConsole               = kernel32.NewProc("ResizePseudoConsole")
	procClosePseudoConsole                = kernel32.NewProc("ClosePseudoConsole")
	procInitializeProcThreadAttributeList = kernel32.NewProc("InitializeProcThreadAttributeList")
	procUpdateProcThreadAttribute         = kernel32.NewProc("UpdateProcThreadAttribute")
	procDeleteProcThreadAttributeList     = kernel32.NewProc("DeleteProcThreadAttributeList")
)

type conptySession struct {
	hpc       windows.Handle
	input     *os.File
	output    *os.File
	process   windows.Handle
	processID uint32
	attrs     *directProcThreadAttributeList

	closeOnce sync.Once
	waitOnce  sync.Once
	waitErr   error
	exitCode  *int
}

type directProcThreadAttributeList struct {
	data []byte
	list *windows.ProcThreadAttributeList
}

func platformLocalTerminalAvailable() bool {
	required := []*windows.LazyProc{
		procCreatePseudoConsole,
		procResizePseudoConsole,
		procClosePseudoConsole,
		procInitializeProcThreadAttributeList,
		procUpdateProcThreadAttribute,
		procDeleteProcThreadAttributeList,
	}
	for _, proc := range required {
		if err := proc.Find(); err != nil {
			return false
		}
	}
	return true
}

func platformProcessElevated() bool {
	var token windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_QUERY, &token); err != nil {
		return false
	}
	defer token.Close()
	return token.IsElevated()
}

func newDirectProcThreadAttributeList(attributeCount uint32) (*directProcThreadAttributeList, error) {
	var size uintptr
	_, _, firstErr := procInitializeProcThreadAttributeList.Call(
		0,
		uintptr(attributeCount),
		0,
		uintptr(unsafe.Pointer(&size)),
	)
	if size == 0 {
		if firstErr != windows.ERROR_INSUFFICIENT_BUFFER {
			return nil, firstErr
		}
		return nil, errors.New("InitializeProcThreadAttributeList returned zero size")
	}
	data := make([]byte, size)
	list := (*windows.ProcThreadAttributeList)(unsafe.Pointer(&data[0]))
	result, _, err := procInitializeProcThreadAttributeList.Call(
		uintptr(unsafe.Pointer(list)),
		uintptr(attributeCount),
		0,
		uintptr(unsafe.Pointer(&size)),
	)
	if result == 0 {
		return nil, err
	}
	return &directProcThreadAttributeList{data: data, list: list}, nil
}

func (a *directProcThreadAttributeList) updatePseudoConsole(hpc windows.Handle) error {
	result, _, err := procUpdateProcThreadAttribute.Call(
		uintptr(unsafe.Pointer(a.list)),
		0,
		windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
		uintptr(hpc),
		unsafe.Sizeof(hpc),
		0,
		0,
	)
	if result == 0 {
		return err
	}
	return nil
}

func (a *directProcThreadAttributeList) delete() {
	if a == nil || a.list == nil {
		return
	}
	procDeleteProcThreadAttributeList.Call(uintptr(unsafe.Pointer(a.list)))
	a.list = nil
	a.data = nil
}

func startPlatformPTY(ctx context.Context, shell string, cwd string, cols int, rows int) (PTY, PTYProcess, error) {
	term, err := startDirectConPTY(shell, cwd, cols, rows)
	if err != nil {
		return nil, nil, err
	}
	go func() {
		<-ctx.Done()
		_ = term.Close()
	}()
	return term, term, nil
}

func startDirectConPTY(shell string, cwd string, cols int, rows int) (*conptySession, error) {
	cols, rows = normalizeSize(cols, rows)
	pseudoInput, input, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("创建本地终端输入管道失败: %w", err)
	}
	output, pseudoOutput, err := os.Pipe()
	if err != nil {
		_ = pseudoInput.Close()
		_ = input.Close()
		return nil, fmt.Errorf("创建本地终端输出管道失败: %w", err)
	}

	var hpc windows.Handle
	if err := windows.CreatePseudoConsole(
		windows.Coord{X: int16(cols), Y: int16(rows)},
		windows.Handle(pseudoInput.Fd()),
		windows.Handle(pseudoOutput.Fd()),
		0,
		&hpc,
	); err != nil {
		_ = pseudoInput.Close()
		_ = input.Close()
		_ = output.Close()
		_ = pseudoOutput.Close()
		return nil, fmt.Errorf("CreatePseudoConsole failed: %w", err)
	}
	_ = pseudoInput.Close()
	_ = pseudoOutput.Close()

	term := &conptySession{
		hpc:    hpc,
		input:  input,
		output: output,
	}

	if err := term.startProcess(shell, cwd); err != nil {
		_ = term.Close()
		return nil, err
	}
	return term, nil
}

func (s *conptySession) startProcess(shell string, cwd string) error {
	attributes, err := newDirectProcThreadAttributeList(1)
	if err != nil {
		return fmt.Errorf("InitializeProcThreadAttributeList failed: %w", err)
	}

	if err := attributes.updatePseudoConsole(s.hpc); err != nil {
		attributes.delete()
		return fmt.Errorf("UpdateProcThreadAttribute PSEUDOCONSOLE failed: %w", err)
	}
	s.attrs = attributes

	startup := &windows.StartupInfoEx{}
	startup.StartupInfo.Cb = uint32(unsafe.Sizeof(*startup))
	startup.StartupInfo.Flags = windows.STARTF_USESTDHANDLES
	startup.ProcThreadAttributeList = attributes.list

	appName, err := windows.UTF16PtrFromString(shell)
	if err != nil {
		return errors.New("本地 shell 路径无效")
	}
	commandLine, err := windows.UTF16PtrFromString(windows.ComposeCommandLine([]string{shell}))
	if err != nil {
		return errors.New("本地 shell 命令行无效")
	}
	var cwdPtr *uint16
	if strings.TrimSpace(cwd) != "" {
		cwdPtr, err = windows.UTF16PtrFromString(cwd)
		if err != nil {
			return errors.New("本地终端工作目录无效")
		}
	}

	var info windows.ProcessInformation
	var zeroSecurity windows.SecurityAttributes
	processSecurity := &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(zeroSecurity)), InheritHandle: 1}
	threadSecurity := &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(zeroSecurity)), InheritHandle: 1}
	flags := uint32(windows.EXTENDED_STARTUPINFO_PRESENT |
		windows.CREATE_UNICODE_ENVIRONMENT |
		windows.CREATE_NEW_PROCESS_GROUP)
	if err := windows.CreateProcess(
		appName,
		commandLine,
		processSecurity,
		threadSecurity,
		false,
		flags,
		nil,
		cwdPtr,
		&startup.StartupInfo,
		&info,
	); err != nil {
		return fmt.Errorf("CreateProcessW failed: %w", err)
	}
	closeHandle(info.Thread)
	s.process = info.Process
	s.processID = info.ProcessId
	return nil
}

func (s *conptySession) Read(data []byte) (int, error) {
	if s.output == nil {
		return 0, io.ErrClosedPipe
	}
	return s.output.Read(data)
}

func (s *conptySession) Write(data []byte) (int, error) {
	if s.input == nil {
		return 0, io.ErrClosedPipe
	}
	return s.input.Write(data)
}

func (s *conptySession) Resize(cols, rows int) error {
	cols, rows = normalizeSize(cols, rows)
	if s.hpc == 0 {
		return io.ErrClosedPipe
	}
	return windows.ResizePseudoConsole(s.hpc, windows.Coord{X: int16(cols), Y: int16(rows)})
}

func (s *conptySession) Close() error {
	var err error
	s.closeOnce.Do(func() {
		closePseudoConsole := true
		if s.process != 0 {
			if running, checkErr := processStillRunning(s.process); checkErr == nil && running {
				if terminateErr := windows.TerminateProcess(s.process, 1); terminateErr == nil {
					event, waitErr := windows.WaitForSingleObject(s.process, 2000)
					if waitErr != nil || event == windowsWaitTimeout || event == windows.WAIT_FAILED {
						closePseudoConsole = false
					}
				} else {
					closePseudoConsole = false
				}
			}
		}
		if s.hpc != 0 && closePseudoConsole {
			windows.ClosePseudoConsole(s.hpc)
			s.hpc = 0
		}
		if s.input != nil {
			err = errors.Join(err, s.input.Close())
			s.input = nil
		}
		if s.output != nil {
			err = errors.Join(err, s.output.Close())
			s.output = nil
		}
		if s.attrs != nil {
			s.attrs.delete()
			s.attrs = nil
		}
	})
	return err
}

func (s *conptySession) Start() error {
	return nil
}

func (s *conptySession) Wait() error {
	s.waitOnce.Do(func() {
		if s.process == 0 {
			s.waitErr = ErrNotFound
			return
		}
		_, err := windows.WaitForSingleObject(s.process, windows.INFINITE)
		if err != nil {
			s.waitErr = err
			return
		}
		var code uint32
		if err := windows.GetExitCodeProcess(s.process, &code); err != nil {
			s.waitErr = err
			return
		}
		exitCode := int(code)
		s.exitCode = &exitCode
		closeHandle(s.process)
		s.process = 0
		if s.attrs != nil {
			s.attrs.delete()
			s.attrs = nil
		}
	})
	return s.waitErr
}

func (s *conptySession) ExitCode() *int {
	if s.exitCode == nil && s.process != 0 {
		var code uint32
		if err := windows.GetExitCodeProcess(s.process, &code); err == nil && code != windowsStillActive {
			exitCode := int(code)
			s.exitCode = &exitCode
		}
	}
	return s.exitCode
}

func (s *conptySession) PID() int {
	return int(s.processID)
}

func processStillRunning(handle windows.Handle) (bool, error) {
	var code uint32
	if err := windows.GetExitCodeProcess(handle, &code); err != nil {
		return false, err
	}
	return code == windowsStillActive, nil
}

func closeHandle(handle windows.Handle) {
	if handle != 0 && handle != windows.InvalidHandle {
		_ = windows.CloseHandle(handle)
	}
}

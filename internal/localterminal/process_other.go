//go:build !windows && !darwin

package localterminal

import (
	"context"
	"errors"
	"os"

	pty "github.com/aymanbagabas/go-pty"
)

const embeddedPTYCreationFlags = 0

func platformLocalTerminalAvailable() bool {
	return false
}

func platformProcessElevated() bool {
	return false
}

func startPlatformPTY(ctx context.Context, shell string, cwd string, cols int, rows int) (PTY, PTYProcess, error) {
	term, err := pty.New()
	if err != nil {
		return nil, nil, ErrUnsupported
	}
	if err := term.Resize(cols, rows); err != nil {
		_ = term.Close()
		return nil, nil, errors.New("调整本地终端尺寸失败")
	}
	cmd := term.CommandContext(ctx, shell, platformShellArgs("linux", shell)...)
	cmd.Dir = cwd
	cmd.Env = platformShellEnv("linux", os.Environ())
	if err := cmd.Start(); err != nil {
		_ = term.Close()
		return nil, nil, errors.New("启动本地 shell 失败")
	}
	return term, cmdProcess{cmd: cmd}, nil
}

type cmdProcess struct {
	cmd *pty.Cmd
}

func (p cmdProcess) Start() error {
	return p.cmd.Start()
}

func (p cmdProcess) Wait() error {
	return p.cmd.Wait()
}

func (p cmdProcess) ExitCode() *int {
	if p.cmd.ProcessState == nil {
		return nil
	}
	code := p.cmd.ProcessState.ExitCode()
	return &code
}

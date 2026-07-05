package sshclient

import (
	"errors"
	"io"
	"sync"

	"golang.org/x/crypto/ssh"
)

type Terminal struct {
	session *ssh.Session
	stdin   io.WriteCloser
	outputR *io.PipeReader
	outputW *io.PipeWriter
	once    sync.Once
}

const terminalType = "xterm-256color"

func (c *Client) OpenTerminal(columns, rows int) (*Terminal, error) {
	if columns < 1 || rows < 1 {
		return nil, errors.New("terminal dimensions must be positive")
	}
	session, err := c.client.NewSession()
	if err != nil {
		return nil, err
	}
	applyTerminalUTF8Locale(session.Setenv)
	applyTerminalColorEnv(session.Setenv)
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := session.RequestPty(terminalType, rows, columns, modes); err != nil {
		session.Close()
		return nil, err
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		return nil, err
	}
	outputR, outputW := io.Pipe()
	session.Stdout = outputW
	session.Stderr = outputW
	if err := session.Shell(); err != nil {
		outputR.Close()
		outputW.Close()
		session.Close()
		return nil, err
	}
	return &Terminal{
		session: session, stdin: stdin, outputR: outputR, outputW: outputW,
	}, nil
}

func applyTerminalColorEnv(setenv func(name, value string) error) {
	_ = setenv("TERM", terminalType)
	_ = setenv("COLORTERM", "truecolor")
}

func applyTerminalUTF8Locale(setenv func(name, value string) error) {
	for _, locale := range []string{"C.UTF-8", "en_US.UTF-8"} {
		lcErr := setenv("LC_CTYPE", locale)
		langErr := setenv("LANG", locale)
		if lcErr == nil || langErr == nil {
			return
		}
	}
}

func (t *Terminal) Read(buffer []byte) (int, error) {
	return t.outputR.Read(buffer)
}

func (t *Terminal) Write(data []byte) (int, error) {
	return t.stdin.Write(data)
}

func (t *Terminal) Resize(columns, rows int) error {
	if columns < 1 || rows < 1 {
		return errors.New("terminal dimensions must be positive")
	}
	return t.session.WindowChange(rows, columns)
}

func (t *Terminal) Wait() error {
	err := t.session.Wait()
	_ = t.outputW.CloseWithError(err)
	return err
}

func (t *Terminal) Close() error {
	var result error
	t.once.Do(func() {
		_ = t.stdin.Close()
		_ = t.outputR.Close()
		_ = t.outputW.Close()
		result = t.session.Close()
	})
	return result
}

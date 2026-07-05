//go:build !windows

package localfiles

import "errors"

type OSShellExecutor struct{}

func (OSShellExecutor) Open(string) error {
	return errors.New("local shell open is only supported on Windows")
}

func (OSShellExecutor) Reveal(string) error {
	return errors.New("local shell reveal is only supported on Windows")
}

func (OSShellExecutor) Properties(string) error {
	return errors.New("local shell properties is only supported on Windows")
}

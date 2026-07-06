//go:build darwin

package localfiles

import "os/exec"

type OSShellExecutor struct {
	run func(string, ...string) error
}

func newDarwinShellExecutor(run func(string, ...string) error) OSShellExecutor {
	return OSShellExecutor{run: run}
}

func (e OSShellExecutor) Open(path string) error {
	return e.runner()("open", path)
}

func (e OSShellExecutor) Reveal(path string) error {
	return e.runner()("open", "-R", path)
}

func (e OSShellExecutor) Properties(path string) error {
	return e.Reveal(path)
}

func (e OSShellExecutor) runner() func(string, ...string) error {
	if e.run != nil {
		return e.run
	}
	return func(name string, args ...string) error {
		return exec.Command(name, args...).Run()
	}
}

//go:build !windows

package localterminal

func RelaunchElevated(string, []string) error {
	return ErrUnsupported
}

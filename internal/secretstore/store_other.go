//go:build !windows && !darwin

package secretstore

func newPlatformStore() Store {
	return RuntimeOnly{}
}

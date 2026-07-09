package main

import (
	"os"
	"path/filepath"
)

const (
	appDataDirName      = "HostDeck"
	appDatabaseFilename = "HostDeck.db"
)

var (
	legacyAppDataDirName   = "Server" + "Pilot"
	legacyDatabaseFilename = "server" + "pilot.db"
	appWebviewDataDirName  = "WebView2"
)

func hostDeckDataDir(configDir string) string {
	return filepath.Join(configDir, appDataDirName)
}

func hostDeckDatabasePath(dataDir string) string {
	return filepath.Join(dataDir, appDatabaseFilename)
}

func hostDeckWebviewUserDataPath(configDir string) string {
	return filepath.Join(hostDeckDataDir(configDir), appWebviewDataDirName)
}

func ensureHostDeckDataDir(configDir string) (string, error) {
	if err := migrateLegacyAppDataDir(configDir); err != nil {
		return "", err
	}
	dataDir := hostDeckDataDir(configDir)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return "", err
	}
	if err := migrateLegacyDatabaseFilename(dataDir); err != nil {
		return "", err
	}
	return dataDir, nil
}

func migrateLegacyAppDataDir(configDir string) error {
	dataDir := hostDeckDataDir(configDir)
	legacyDir := filepath.Join(configDir, legacyAppDataDirName)
	if _, err := os.Stat(dataDir); err == nil {
		return migrateLegacyDatabaseFilename(dataDir)
	} else if !os.IsNotExist(err) {
		return err
	}
	if _, err := os.Stat(legacyDir); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if err := os.Rename(legacyDir, dataDir); err != nil {
		return err
	}
	return migrateLegacyDatabaseFilename(dataDir)
}

func migrateLegacyDatabaseFilename(dataDir string) error {
	next := hostDeckDatabasePath(dataDir)
	if _, err := os.Stat(next); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	legacy := filepath.Join(dataDir, legacyDatabaseFilename)
	if _, err := os.Stat(legacy); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return os.Rename(legacy, next)
}

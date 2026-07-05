package sftpmanager

import (
	"fmt"
	"path"
	"strings"
)

func cleanRemotePath(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if value == "" || value == "." {
		return "."
	}
	if value == "/" {
		return "/"
	}
	cleaned := path.Clean(value)
	if strings.HasPrefix(value, "/") && !strings.HasPrefix(cleaned, "/") {
		cleaned = "/" + cleaned
	}
	return cleaned
}

func resolveRemotePath(currentPath, candidate string) string {
	candidate = strings.TrimSpace(strings.ReplaceAll(candidate, "\\", "/"))
	if candidate == "" {
		return cleanRemotePath(currentPath)
	}
	if strings.HasPrefix(candidate, "/") || candidate == "." || strings.HasPrefix(candidate, "./") {
		return cleanRemotePath(candidate)
	}
	return joinRemotePath(currentPath, candidate)
}

func joinRemotePath(parentPath, name string) string {
	parentPath = cleanRemotePath(parentPath)
	name = strings.TrimSpace(strings.ReplaceAll(name, "\\", "/"))
	if name == "" {
		return parentPath
	}
	if strings.HasPrefix(name, "/") {
		return cleanRemotePath(name)
	}
	if parentPath == "." {
		return cleanRemotePath(name)
	}
	return cleanRemotePath(path.Join(parentPath, name))
}

func parentRemotePath(value string) string {
	value = cleanRemotePath(value)
	if value == "/" || value == "." {
		return value
	}
	parent := path.Dir(value)
	if parent == "." && strings.HasPrefix(value, "/") {
		return "/"
	}
	return cleanRemotePath(parent)
}

func baseRemotePath(value string) string {
	value = cleanRemotePath(value)
	if value == "/" || value == "." {
		return value
	}
	return path.Base(value)
}

func validateRemoteName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("name is empty")
	}
	if strings.Contains(name, "/") || strings.Contains(name, "\\") {
		return fmt.Errorf("name must not contain a path separator")
	}
	if name == "." || name == ".." {
		return fmt.Errorf("name is reserved")
	}
	return nil
}

func remoteRenameCandidate(original string, index int) string {
	dir, base := path.Split(cleanRemotePath(original))
	ext := path.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	if stem == "" {
		stem = base
		ext = ""
	}
	return cleanRemotePath(path.Join(dir, fmt.Sprintf("%s (%d)%s", stem, index, ext)))
}

package localterminal

import (
	"path/filepath"
	"strings"
)

func platformShellArgs(platform string, shell string) []string {
	if platform != "darwin" {
		return nil
	}
	switch strings.ToLower(filepath.Base(shell)) {
	case "zsh", "bash":
		return []string{"-l"}
	default:
		return nil
	}
}

func platformShellEnv(platform string, base []string) []string {
	keys := map[string]bool{"TERM": true}
	if platform == "darwin" {
		keys["COLORTERM"] = true
		keys["CLICOLOR"] = true
	}
	env := make([]string, 0, len(base)+len(keys))
	for _, value := range base {
		name, _, ok := strings.Cut(value, "=")
		if ok && keys[name] {
			continue
		}
		env = append(env, value)
	}
	env = append(env, "TERM=xterm-256color")
	if platform == "darwin" {
		env = append(env, "COLORTERM=truecolor", "CLICOLOR=1")
	}
	return env
}

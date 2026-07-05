package domain

import (
	"errors"
	"net"
	"strconv"
	"strings"
)

func NormalizeServerDisplayName(name string, host string, port int) (string, error) {
	if strings.TrimSpace(host) == "" {
		return "", errors.New("host is required")
	}
	if port < 1 || port > 65535 {
		return "", errors.New("port must be between 1 and 65535")
	}
	trimmedName := strings.TrimSpace(name)
	if trimmedName != "" {
		return trimmedName, nil
	}
	return net.JoinHostPort(strings.TrimSpace(host), strconv.Itoa(port)), nil
}

func ValidateConnection(request SaveConnectionRequest) error {
	if _, err := NormalizeServerDisplayName(request.Name, request.Host, request.Port); err != nil {
		return err
	}
	if strings.TrimSpace(request.Username) == "" {
		return errors.New("username is required")
	}
	if request.AuthType != AuthPassword && request.AuthType != AuthPrivateKey {
		return errors.New("unsupported authentication type")
	}
	if request.ConnectionMode == "" {
		request.ConnectionMode = ConnectionModeDirect
	}
	switch request.ConnectionMode {
	case ConnectionModeDirect:
	case ConnectionModeJump:
		if request.JumpServerID == nil || *request.JumpServerID <= 0 {
			return errors.New("请选择跳板机")
		}
		if request.ID > 0 && *request.JumpServerID == request.ID {
			return errors.New("目标服务器不能选择自己作为跳板机")
		}
	default:
		return errors.New("连接路径无效")
	}
	if request.AuthType == AuthPrivateKey {
		source := request.PrivateKeySource
		if source == "" {
			source = PrivateKeySourceLocalFile
		}
		switch source {
		case PrivateKeySourceLocalFile:
			if strings.TrimSpace(request.PrivateKeyPath) == "" {
				return errors.New("private key path is required")
			}
		case PrivateKeySourceKeyVault:
			if request.KeyVaultID == nil || *request.KeyVaultID <= 0 {
				return errors.New("key vault entry is required")
			}
		default:
			return errors.New("unsupported private key source")
		}
	}
	if request.RefreshInterval != 1 && request.RefreshInterval != 2 && request.RefreshInterval != 5 {
		return errors.New("refresh interval must be 1, 2, or 5 seconds")
	}
	return nil
}

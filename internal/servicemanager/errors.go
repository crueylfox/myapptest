package servicemanager

import (
	"context"
	"errors"
	"strings"

	"serverpilot/internal/domain"
)

func userMessageForError(err error, fallback string) string {
	if err == nil {
		return ""
	}
	if isTimeoutError(err) {
		return timeoutMessage
	}
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "sudo") &&
		(strings.Contains(message, "password") ||
			strings.Contains(message, "not in the sudoers") ||
			strings.Contains(message, "a password is required")):
		return permissionMessage
	case strings.Contains(message, "permission denied") ||
		strings.Contains(message, "access denied") ||
		strings.Contains(message, "interactive authentication required"):
		return permissionMessage
	case strings.Contains(message, "not found") ||
		strings.Contains(message, "no such file") ||
		strings.Contains(message, "could not be found") ||
		strings.Contains(message, "does not exist") ||
		strings.Contains(message, "unit ") && strings.Contains(message, "not loaded"):
		return "服务不存在或已被移除。"
	default:
		return fallback
	}
}

func userMessageForServiceError(initSystem domain.ServiceManagerInitSystem, err error, fallback string) string {
	message := userMessageForError(err, fallback)
	if initSystem == domain.ServiceManagerInitSystemOpenWrtProcd && message == permissionMessage {
		return procdPermissionMessage
	}
	return message
}

func isTimeoutError(err error) bool {
	return errors.Is(err, context.DeadlineExceeded) ||
		strings.Contains(err.Error(), "context deadline exceeded") ||
		strings.Contains(err.Error(), "i/o timeout")
}

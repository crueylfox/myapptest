package sftpmanager

import (
	"context"
	"errors"
	"hostdeck/internal/connectionerror"
	"hostdeck/internal/domain"
	"io"
	"net"
	"strings"
)

func saveCodeForError(err error) string {
	classified := classifySFTPError(err)
	switch classified.code {
	case "SFTP_PERMISSION_DENIED":
		return "SFTP_SAVE_PERMISSION_DENIED"
	case "SFTP_NOT_FOUND":
		return "SFTP_SAVE_NOT_FOUND"
	case "SFTP_NO_SPACE":
		return "SFTP_SAVE_NO_SPACE"
	case "SFTP_CONNECTION_CLOSED", "SFTP_CANCELED":
		return "SFTP_SAVE_CONNECTION_CLOSED"
	case "SFTP_EXISTS":
		return "SFTP_SAVE_TARGET_EXISTS"
	default:
		return "SFTP_SAVE_UNKNOWN"
	}
}

func saveMessageForStage(stage string, err error) string {
	classified := classifySFTPError(err)
	switch classified.code {
	case "SFTP_PERMISSION_DENIED":
		return "保存失败：没有写入权限。"
	case "SFTP_NOT_FOUND":
		return "保存失败：目标文件不存在或已被删除。"
	case "SFTP_NO_SPACE":
		return "保存失败：远程磁盘空间不足。"
	case "SFTP_CONNECTION_CLOSED", "SFTP_CANCELED":
		return "保存失败：连接已断开。"
	}
	switch stage {
	case "stat_before_save":
		return "保存失败：无法读取远程文件状态。"
	case "create_temp_file":
		return "保存失败：无法创建临时文件。"
	case "write_temp_file":
		return "保存失败：无法写入临时文件。"
	case "close_temp_file":
		return "保存失败：无法完成临时文件写入。"
	case "rename_temp_to_target":
		return "保存失败：服务器不支持覆盖式重命名，且直接写入兜底失败。"
	case "fallback_direct_write":
		return "保存失败：无法直接写入目标文件。"
	case "stat_after_save":
		return "保存失败：文件已写入，但无法刷新远程文件状态。"
	default:
		return "保存失败：未知错误，请查看技术详情。"
	}
}

func isRetryableSFTPError(err error) bool {
	classified := classifySFTPError(err)
	return classified.code == "SFTP_CONNECTION_CLOSED" || classified.code == "SFTP_CANCELED" || classified.code == "SFTP_UNKNOWN"
}

func (m *Manager) operationError(connectionID int64, contextID string, operation string, err error) error {
	classified := classifySFTPError(err)
	m.emitError(connectionID, contextID, operation, classified.code, classified.message, err.Error())
	return errors.New(classified.message)
}

func (m *Manager) operationErrorForSession(current *session, operation string, err error) error {
	classified := classifySFTPError(err)
	if isClosedTransportError(err) {
		m.invalidateSession(current, classified.message)
	}
	m.emitErrorWithGeneration(current.connectionID, current.contextID, current.generation, "", operation, classified.code, classified.message, err.Error())
	return errors.New(classified.message)
}

func (m *Manager) emitErrorWithGeneration(connectionID int64, contextID string, generation int64, requestID string, operation, code, message, technical string) {
	if m.emitter != nil {
		m.emitter.Error(domain.SFTPErrorEvent{
			ConnectionID: connectionID,
			ContextID:    normalizeContextID(connectionID, contextID),
			Generation:   generation,
			RequestID:    requestID,
			Operation:    operation,
			Code:         code,
			Message:      message,
			Technical:    technical,
			UpdatedAt:    now(),
		})
	}
}

type sftpClassifiedError struct {
	code    string
	message string
}

func classifySFTPError(err error) sftpClassifiedError {
	message := strings.ToLower(err.Error())
	switch {
	case errors.Is(err, context.Canceled):
		return sftpClassifiedError{"SFTP_CANCELED", "操作已取消"}
	case isClosedTransportError(err):
		return sftpClassifiedError{"SFTP_CONNECTION_CLOSED", "SFTP 连接已关闭"}
	case strings.Contains(message, "scp"):
		return sftpClassifiedError{"SCP_TRANSFER_FAILED", "SCP 传输失败"}
	case strings.Contains(message, "permission denied"):
		return sftpClassifiedError{"SFTP_PERMISSION_DENIED", "权限不足"}
	case strings.Contains(message, "no such file") || strings.Contains(message, "not exist"):
		return sftpClassifiedError{"SFTP_NOT_FOUND", "文件或目录不存在"}
	case strings.Contains(message, "failure") && strings.Contains(message, "directory"):
		return sftpClassifiedError{"SFTP_DIRECTORY_NOT_EMPTY", "目录不是空目录或无法删除"}
	case strings.Contains(message, "exists"):
		return sftpClassifiedError{"SFTP_EXISTS", "文件或目录已存在"}
	case strings.Contains(message, "space"):
		return sftpClassifiedError{"SFTP_NO_SPACE", "磁盘空间不足"}
	case strings.Contains(message, "closed") || strings.Contains(message, "eof") || strings.Contains(message, "connection"):
		return sftpClassifiedError{"SFTP_CONNECTION_CLOSED", "SFTP 连接已关闭"}
	default:
		return sftpClassifiedError{"SFTP_UNKNOWN", "SFTP 操作失败"}
	}
}

func isClosedTransportError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.EOF) ||
		errors.Is(err, io.ErrClosedPipe) ||
		errors.Is(err, net.ErrClosed) ||
		errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "connection reset") ||
		strings.Contains(message, "broken pipe") ||
		strings.Contains(message, "ssh: session closed") ||
		strings.Contains(message, "sftp connection lost") ||
		strings.Contains(message, "operation timeout") ||
		strings.Contains(message, "route transport closed") ||
		strings.Contains(message, "use of closed network connection") ||
		strings.Contains(message, "client connection lost") ||
		strings.Contains(message, "server unexpectedly closed network connection") ||
		strings.Contains(message, "connection closed") ||
		strings.Contains(message, "closed pipe") ||
		strings.Contains(message, "eof")
}

func classifySFTPOpenError(err error, connection domain.Connection) domain.ConnectionError {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "subsystem request failed") ||
		strings.Contains(message, "subsystem") && strings.Contains(message, "failed") ||
		strings.Contains(message, "remote command exited") ||
		strings.Contains(message, "sftp-server") && strings.Contains(message, "not found") ||
		strings.Contains(message, "openssh-sftp-server") && strings.Contains(message, "not found"):
		return domain.ConnectionError{
			Code:             "SFTP_UNSUPPORTED",
			UserMessage:      "当前服务器未启用 SFTP 子系统，SSH 终端仍可正常使用。OpenWrt/ImmortalWrt 可尝试安装 openssh-sftp-server：opkg update && opkg install openssh-sftp-server。",
			TechnicalMessage: err.Error(),
			Operation:        "sftp.open",
			ServerID:         connection.ID,
			Timestamp:        now(),
		}
	case strings.Contains(message, "channel") && strings.Contains(message, "closed"):
		return domain.ConnectionError{
			Code:             "SFTP_REMOTE_CLOSED_DURING_INIT",
			UserMessage:      "远端在初始化 SFTP 时关闭了通道。SSH 终端可能仍可使用，请检查服务器是否启用了 SFTP 子系统。",
			TechnicalMessage: err.Error(),
			Operation:        "sftp.open",
			ServerID:         connection.ID,
			Timestamp:        now(),
		}
	default:
		classified := connectionerror.Classify(err, connection, "sftp.open")
		if strings.Contains(message, "eof") || strings.Contains(message, "connection closed") {
			classified.Code = "SFTP_REMOTE_CLOSED_DURING_INIT"
			classified.UserMessage = "远端在初始化 SFTP 时关闭了连接。SSH 终端可能仍可使用，请检查服务器是否启用了 SFTP 子系统。"
		}
		return classified
	}
}

func isSCPFallbackError(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "sftp_unsupported") ||
		strings.Contains(message, "subsystem request failed") ||
		strings.Contains(message, "subsystem") && strings.Contains(message, "failed") ||
		strings.Contains(message, "remote closed during init") ||
		strings.Contains(message, "remote command exited") ||
		strings.Contains(message, "sftp-server") && (strings.Contains(message, "not found") || strings.Contains(message, "no such file")) ||
		strings.Contains(message, "openssh-sftp-server") && (strings.Contains(message, "not found") || strings.Contains(message, "no such file")) ||
		strings.Contains(message, "channel") && strings.Contains(message, "closed") ||
		strings.Contains(message, "eof") ||
		strings.Contains(message, "connection closed")
}

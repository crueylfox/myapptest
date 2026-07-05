package sftpmanager

import (
	"errors"
	"strings"
)

func validateOperationGeneration(current *session, generation int64) error {
	if generation > 0 && current.generation > 0 && generation != current.generation {
		return errors.New("SFTP 连接上下文已过期，请重新加载后再试")
	}
	return nil
}

func validateRemoteItemPath(remotePath string) error {
	if strings.TrimSpace(remotePath) == "" {
		return errors.New("远程路径不能为空")
	}
	if strings.ContainsAny(remotePath, "\x00\r\n") {
		return errors.New("远程路径包含非法控制字符")
	}
	if hasParentTraversal(remotePath) {
		return errors.New("远程路径不能包含 ..")
	}
	cleaned := cleanRemotePath(remotePath)
	if cleaned == "" || cleaned == "." || cleaned == ".." || baseRemotePath(cleaned) == ".." {
		return errors.New("远程路径无效")
	}
	return nil
}

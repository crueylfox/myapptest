package sftpmanager

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"hostdeck/internal/domain"
)

type deleteTarget struct {
	path string
	info fs.FileInfo
}

func (m *Manager) InspectDelete(ctx context.Context, request domain.SFTPInspectDeleteRequest) (domain.SFTPInspectDeleteResponse, error) {
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return domain.SFTPInspectDeleteResponse{}, err
	}
	if current.mode == domain.SFTPModeSCP {
		current.mu.RLock()
		base := current.currentPath
		current.mu.RUnlock()
		paths, err := normalizeDeletePaths(base, request.Paths)
		if err != nil {
			return domain.SFTPInspectDeleteResponse{}, err
		}
		return m.scpShellInspectDelete(ctx, current, paths)
	}
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	paths, err := normalizeDeletePaths(base, request.Paths)
	if err != nil {
		return domain.SFTPInspectDeleteResponse{}, err
	}
	response := domain.SFTPInspectDeleteResponse{
		ConnectionID: request.ConnectionID,
		ContextID:    current.contextID,
		Paths:        paths,
	}
	for _, remotePath := range paths {
		if err := ctx.Err(); err != nil {
			return domain.SFTPInspectDeleteResponse{}, err
		}
		info, err := current.client.Lstat(remotePath)
		if err != nil {
			return domain.SFTPInspectDeleteResponse{}, m.operationError(request.ConnectionID, request.ContextID, "sftp.delete.inspect.stat", err)
		}
		if err := inspectDeleteEntry(ctx, current.client, remotePath, info, true, &response); err != nil {
			return domain.SFTPInspectDeleteResponse{}, m.operationError(request.ConnectionID, request.ContextID, "sftp.delete.inspect", err)
		}
	}
	return response, nil
}

func (m *Manager) Delete(ctx context.Context, request domain.SFTPDeleteRequest) error {
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return err
	}
	if current.mode == domain.SFTPModeSCP {
		current.mu.RLock()
		base := current.currentPath
		current.mu.RUnlock()
		rawPaths := request.Paths
		if len(rawPaths) == 0 && strings.TrimSpace(request.Path) != "" {
			rawPaths = []string{request.Path}
		}
		paths, err := normalizeDeletePaths(base, rawPaths)
		if err != nil {
			return err
		}
		return m.scpShellDelete(ctx, current, paths, request.Recursive)
	}
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	rawPaths := request.Paths
	if len(rawPaths) == 0 && strings.TrimSpace(request.Path) != "" {
		rawPaths = []string{request.Path}
	}
	paths, err := normalizeDeletePaths(base, rawPaths)
	if err != nil {
		return err
	}
	targets := make([]deleteTarget, 0, len(paths))
	for _, remotePath := range paths {
		if err := ctx.Err(); err != nil {
			return err
		}
		info, err := current.client.Lstat(remotePath)
		if err != nil {
			return m.operationError(request.ConnectionID, request.ContextID, "sftp.delete.stat", err)
		}
		if info.IsDir() && info.Mode()&fs.ModeSymlink == 0 && !request.Recursive {
			entries, err := current.client.ReadDir(ctx, remotePath)
			if err != nil {
				return m.operationError(request.ConnectionID, request.ContextID, "sftp.delete.inspect_dir", err)
			}
			if len(entries) > 0 {
				return errors.New("目录非空，请使用递归删除")
			}
		}
		targets = append(targets, deleteTarget{path: remotePath, info: info})
	}
	for _, target := range targets {
		if err := ctx.Err(); err != nil {
			return err
		}
		if target.info.IsDir() && target.info.Mode()&fs.ModeSymlink == 0 {
			if request.Recursive {
				if err := deleteDirectoryRecursive(ctx, current.client, target.path, true); err != nil {
					return fmt.Errorf("递归删除目录失败: %w", err)
				}
				continue
			}
			if err := current.client.RemoveDirectory(target.path); err != nil {
				return m.operationError(request.ConnectionID, request.ContextID, "sftp.delete.rmdir", err)
			}
			continue
		}
		if err := current.client.Remove(target.path); err != nil {
			return m.operationError(request.ConnectionID, request.ContextID, "sftp.delete.remove", err)
		}
	}
	return nil
}

func inspectDeleteEntry(
	ctx context.Context,
	client Client,
	remotePath string,
	info fs.FileInfo,
	root bool,
	response *domain.SFTPInspectDeleteResponse,
) error {
	if info.Mode()&fs.ModeSymlink != 0 {
		response.SymlinkCount++
		response.TotalBytes += info.Size()
		return nil
	}
	if !info.IsDir() {
		response.FileCount++
		response.TotalBytes += info.Size()
		return nil
	}
	response.DirectoryCount++
	response.RequiresRecursive = true
	entries, err := client.ReadDir(ctx, remotePath)
	if err != nil {
		if root {
			return fmt.Errorf("无法读取目录内容 %s: %w", baseRemotePath(remotePath), err)
		}
		response.Warnings = append(response.Warnings, safePathWarning("跳过不可读取目录", remotePath, err))
		return nil
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry == nil {
			continue
		}
		name := entry.Name()
		if !safeRemoteChildName(name) {
			response.Warnings = append(response.Warnings, safePathWarning("跳过不安全远程名称", name, nil))
			continue
		}
		childPath := joinRemotePath(remotePath, name)
		if err := inspectDeleteEntry(ctx, client, childPath, entry, false, response); err != nil {
			return err
		}
	}
	return nil
}

func deleteDirectoryRecursive(ctx context.Context, client Client, remotePath string, root bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	entries, err := client.ReadDir(ctx, remotePath)
	if err != nil {
		return fmt.Errorf("扫描目录失败 %s: %w", baseRemotePath(remotePath), err)
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry == nil {
			continue
		}
		name := entry.Name()
		if !safeRemoteChildName(name) {
			return fmt.Errorf("远程名称不安全: %s", name)
		}
		childPath := joinRemotePath(remotePath, name)
		if entry.Mode()&fs.ModeSymlink != 0 || !entry.IsDir() {
			if err := client.Remove(childPath); err != nil {
				return fmt.Errorf("删除文件失败 %s: %w", name, err)
			}
			continue
		}
		if err := deleteDirectoryRecursive(ctx, client, childPath, false); err != nil {
			return err
		}
	}
	if err := client.RemoveDirectory(remotePath); err != nil {
		if root {
			return fmt.Errorf("删除目标目录失败 %s: %w", baseRemotePath(remotePath), err)
		}
		return fmt.Errorf("删除子目录失败 %s: %w", baseRemotePath(remotePath), err)
	}
	return nil
}

func normalizeDeletePaths(base string, rawPaths []string) ([]string, error) {
	if len(rawPaths) == 0 {
		return nil, errors.New("请选择要删除的远程项目")
	}
	unique := make(map[string]struct{}, len(rawPaths))
	paths := make([]string, 0, len(rawPaths))
	for _, rawPath := range rawPaths {
		remotePath, err := normalizeDeletePath(base, rawPath)
		if err != nil {
			return nil, err
		}
		if _, ok := unique[remotePath]; ok {
			continue
		}
		unique[remotePath] = struct{}{}
		paths = append(paths, remotePath)
	}
	sort.Slice(paths, func(i, j int) bool {
		if len(paths[i]) == len(paths[j]) {
			return paths[i] < paths[j]
		}
		return len(paths[i]) < len(paths[j])
	})
	collapsed := make([]string, 0, len(paths))
	for _, candidate := range paths {
		nested := false
		for _, parent := range collapsed {
			if isRemoteDescendant(parent, candidate) {
				nested = true
				break
			}
		}
		if !nested {
			collapsed = append(collapsed, candidate)
		}
	}
	return collapsed, nil
}

func normalizeDeletePath(base, rawPath string) (string, error) {
	rawPath = strings.TrimSpace(strings.ReplaceAll(rawPath, "\\", "/"))
	if rawPath == "" {
		return "", errors.New("远程路径不能为空")
	}
	if hasParentTraversal(rawPath) {
		return "", errors.New("删除路径不能包含 ..")
	}
	remotePath := resolveRemotePath(base, rawPath)
	if remotePath == "" || remotePath == "." || remotePath == "/" || remotePath == ".." {
		return "", errors.New("拒绝删除根目录或保留路径")
	}
	if hasParentTraversal(remotePath) {
		return "", errors.New("删除路径不能包含 ..")
	}
	return remotePath, nil
}

func safeRemoteChildName(name string) bool {
	return name != "" &&
		name != "." &&
		name != ".." &&
		!strings.Contains(name, "/") &&
		!strings.Contains(name, "\\")
}

func isRemoteDescendant(parent, child string) bool {
	parent = cleanRemotePath(parent)
	child = cleanRemotePath(child)
	if parent == child {
		return true
	}
	if parent == "/" || parent == "." {
		return false
	}
	return strings.HasPrefix(child, parent+"/")
}

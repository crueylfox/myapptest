package sftpmanager

import (
	"context"
	"errors"
	"io/fs"
	"strconv"
	"strings"
	"time"

	pkgsftp "github.com/pkg/sftp"

	"serverpilot/internal/domain"
)

func (m *Manager) Stat(ctx context.Context, request domain.SFTPStatRequest) (domain.SFTPEntry, error) {
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return domain.SFTPEntry{}, err
	}
	if current.mode == domain.SFTPModeSCP {
		current.mu.RLock()
		base := current.currentPath
		current.mu.RUnlock()
		remotePath, err := normalizeSCPRequestPath(base, request.Path, true)
		if err != nil {
			return domain.SFTPEntry{}, err
		}
		return m.scpShellStat(ctx, current, remotePath)
	}
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	remotePath := resolveRemotePath(base, request.Path)
	if err := ctx.Err(); err != nil {
		return domain.SFTPEntry{}, err
	}
	info, err := current.client.Lstat(remotePath)
	if err != nil {
		return domain.SFTPEntry{}, m.operationErrorForSession(current, "sftp.stat", err)
	}
	return fileInfoToEntry(parentRemotePath(remotePath), info), nil
}

func (m *Manager) GetItemProperties(ctx context.Context, request domain.SFTPItemPropertiesRequest) (domain.SFTPItemProperties, error) {
	if err := validateRemoteItemPath(request.Path); err != nil {
		return domain.SFTPItemProperties{}, err
	}
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return domain.SFTPItemProperties{}, err
	}
	if err := validateOperationGeneration(current, request.Generation); err != nil {
		return domain.SFTPItemProperties{}, err
	}
	if current.mode == domain.SFTPModeSCP {
		current.mu.RLock()
		base := current.currentPath
		current.mu.RUnlock()
		remotePath, err := normalizeSCPRequestPath(base, request.Path, true)
		if err != nil {
			return domain.SFTPItemProperties{}, err
		}
		entry, err := m.scpShellStat(ctx, current, remotePath)
		if err != nil {
			return domain.SFTPItemProperties{}, err
		}
		return propertiesFromEntry(current, request.RequestID, entry), nil
	}
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	remotePath := resolveRemotePath(base, request.Path)
	if err := validateRemoteItemPath(remotePath); err != nil {
		return domain.SFTPItemProperties{}, err
	}
	if err := ctx.Err(); err != nil {
		return domain.SFTPItemProperties{}, err
	}
	info, err := current.client.Lstat(remotePath)
	if err != nil {
		return domain.SFTPItemProperties{}, m.operationErrorForSession(current, "sftp.properties", err)
	}
	return propertiesFromInfo(current, request.RequestID, parentRemotePath(remotePath), info), nil
}

func (m *Manager) UpdateItemPermissions(ctx context.Context, request domain.SFTPUpdateItemPermissionsRequest) (domain.SFTPItemProperties, error) {
	if err := validateRemoteItemPath(request.Path); err != nil {
		return domain.SFTPItemProperties{}, err
	}
	if request.Mode&^uint32(0o777) != 0 {
		return domain.SFTPItemProperties{}, errors.New("本轮仅支持编辑普通 Unix 权限位")
	}
	current, err := m.activeSession(request.ConnectionID, request.ContextID)
	if err != nil {
		return domain.SFTPItemProperties{}, err
	}
	if err := validateOperationGeneration(current, request.Generation); err != nil {
		return domain.SFTPItemProperties{}, err
	}
	if current.mode == domain.SFTPModeSCP {
		current.mu.RLock()
		base := current.currentPath
		current.mu.RUnlock()
		remotePath, err := normalizeSCPRequestPath(base, request.Path, false)
		if err != nil {
			return domain.SFTPItemProperties{}, err
		}
		before, err := m.scpShellStat(ctx, current, remotePath)
		if err != nil {
			return domain.SFTPItemProperties{}, err
		}
		if before.IsSymlink {
			return domain.SFTPItemProperties{}, errors.New("符号链接权限不在本轮修改范围")
		}
		nextMode := request.Mode & 0o777
		if request.PreserveSpecialBits {
			nextMode |= unixModeFromEntry(before) & 0o7000
		}
		if err := m.scpShellChmod(ctx, current, remotePath, nextMode); err != nil {
			return domain.SFTPItemProperties{}, err
		}
		after, err := m.scpShellStat(ctx, current, remotePath)
		if err != nil {
			return domain.SFTPItemProperties{}, err
		}
		return propertiesFromEntry(current, request.RequestID, after), nil
	}
	current.mu.RLock()
	base := current.currentPath
	current.mu.RUnlock()
	remotePath := resolveRemotePath(base, request.Path)
	if err := validateRemoteItemPath(remotePath); err != nil {
		return domain.SFTPItemProperties{}, err
	}
	if err := ctx.Err(); err != nil {
		return domain.SFTPItemProperties{}, err
	}
	info, err := current.client.Lstat(remotePath)
	if err != nil {
		return domain.SFTPItemProperties{}, m.operationErrorForSession(current, "sftp.chmod.stat", err)
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return domain.SFTPItemProperties{}, errors.New("符号链接权限不在本轮修改范围")
	}
	nextMode := request.Mode & 0o777
	if request.PreserveSpecialBits {
		nextMode |= unixModeBits(info.Mode()) & 0o7000
	}
	if err := current.client.Chmod(remotePath, fileModeFromUnixMode(nextMode)); err != nil {
		return domain.SFTPItemProperties{}, m.operationErrorForSession(current, "sftp.chmod", err)
	}
	info, err = current.client.Lstat(remotePath)
	if err != nil {
		return domain.SFTPItemProperties{}, m.operationErrorForSession(current, "sftp.chmod.stat_after", err)
	}
	return propertiesFromInfo(current, request.RequestID, parentRemotePath(remotePath), info), nil
}

func fileInfoToEntry(parentPath string, info fs.FileInfo) domain.SFTPEntry {
	owner, group := "—", "—"
	if stat, ok := info.Sys().(*pkgsftp.FileStat); ok {
		owner = strconv.FormatUint(uint64(stat.UID), 10)
		group = strconv.FormatUint(uint64(stat.GID), 10)
	}
	mode := info.Mode()
	return domain.SFTPEntry{
		Name:        info.Name(),
		Path:        joinRemotePath(parentPath, info.Name()),
		ParentPath:  parentPath,
		Size:        info.Size(),
		IsDir:       info.IsDir(),
		IsSymlink:   mode&fs.ModeSymlink != 0,
		Permissions: mode.String(),
		Owner:       owner,
		Group:       group,
		ModTime:     info.ModTime().UTC().Format(time.RFC3339Nano),
	}
}

func propertiesFromInfo(current *session, requestID, parentPath string, info fs.FileInfo) domain.SFTPItemProperties {
	entry := fileInfoToEntry(parentPath, info)
	mode := info.Mode()
	entry.Permissions = unixPermissionString(mode)
	return domain.SFTPItemProperties{
		ConnectionID:      current.connectionID,
		ContextID:         current.contextID,
		TerminalSessionID: current.terminalSessionID,
		Generation:        current.generation,
		RequestID:         requestID,
		Path:              entry.Path,
		Name:              entry.Name,
		Type:              remoteItemType(entry.IsDir, entry.IsSymlink),
		Size:              entry.Size,
		ModTime:           entry.ModTime,
		Permissions:       entry.Permissions,
		Mode:              unixModeBits(mode),
		Owner:             entry.Owner,
		Group:             entry.Group,
		IsDir:             entry.IsDir,
		IsSymlink:         entry.IsSymlink,
		SymlinkTarget:     "",
		Entry:             entry,
	}
}

func propertiesFromEntry(current *session, requestID string, entry domain.SFTPEntry) domain.SFTPItemProperties {
	mode := unixModeFromEntry(entry)
	typedMode := fileModeFromUnixMode(mode)
	if entry.IsDir {
		typedMode |= fs.ModeDir
	}
	if entry.IsSymlink {
		typedMode |= fs.ModeSymlink
	}
	permissions := unixPermissionString(typedMode)
	return domain.SFTPItemProperties{
		ConnectionID:      current.connectionID,
		ContextID:         current.contextID,
		TerminalSessionID: current.terminalSessionID,
		Generation:        current.generation,
		RequestID:         requestID,
		Path:              entry.Path,
		Name:              entry.Name,
		Type:              remoteItemType(entry.IsDir, entry.IsSymlink),
		Size:              entry.Size,
		ModTime:           entry.ModTime,
		Permissions:       permissions,
		Mode:              mode,
		Owner:             entry.Owner,
		Group:             entry.Group,
		IsDir:             entry.IsDir,
		IsSymlink:         entry.IsSymlink,
		SymlinkTarget:     "",
		Entry:             entry,
	}
}

func remoteItemType(isDir, isSymlink bool) string {
	if isSymlink {
		return "symlink"
	}
	if isDir {
		return "directory"
	}
	return "file"
}

func parseUnixMode(value string) (uint32, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	parsed, err := strconv.ParseUint(value, 8, 32)
	if err != nil {
		return 0, false
	}
	return uint32(parsed) & 0o7777, true
}

func unixModeFromEntry(entry domain.SFTPEntry) uint32 {
	if mode, ok := parseUnixMode(entry.Permissions); ok {
		return mode
	}
	return unixModeBits(fileModeFromNumeric(entry.Permissions, entry.IsDir, entry.IsSymlink))
}

func unixModeBits(mode fs.FileMode) uint32 {
	bits := uint32(mode.Perm())
	if mode&fs.ModeSetuid != 0 {
		bits |= 0o4000
	}
	if mode&fs.ModeSetgid != 0 {
		bits |= 0o2000
	}
	if mode&fs.ModeSticky != 0 {
		bits |= 0o1000
	}
	return bits
}

func fileModeFromUnixMode(bits uint32) fs.FileMode {
	mode := fs.FileMode(bits & 0o777)
	if bits&0o4000 != 0 {
		mode |= fs.ModeSetuid
	}
	if bits&0o2000 != 0 {
		mode |= fs.ModeSetgid
	}
	if bits&0o1000 != 0 {
		mode |= fs.ModeSticky
	}
	return mode
}

func unixPermissionString(mode fs.FileMode) string {
	out := []byte("----------")
	if mode&fs.ModeDir != 0 {
		out[0] = 'd'
	} else if mode&fs.ModeSymlink != 0 {
		out[0] = 'l'
	}
	perm := mode.Perm()
	if perm&0o400 != 0 {
		out[1] = 'r'
	}
	if perm&0o200 != 0 {
		out[2] = 'w'
	}
	if perm&0o100 != 0 {
		out[3] = 'x'
	}
	if perm&0o040 != 0 {
		out[4] = 'r'
	}
	if perm&0o020 != 0 {
		out[5] = 'w'
	}
	if perm&0o010 != 0 {
		out[6] = 'x'
	}
	if perm&0o004 != 0 {
		out[7] = 'r'
	}
	if perm&0o002 != 0 {
		out[8] = 'w'
	}
	if perm&0o001 != 0 {
		out[9] = 'x'
	}
	if mode&fs.ModeSetuid != 0 {
		if out[3] == 'x' {
			out[3] = 's'
		} else {
			out[3] = 'S'
		}
	}
	if mode&fs.ModeSetgid != 0 {
		if out[6] == 'x' {
			out[6] = 's'
		} else {
			out[6] = 'S'
		}
	}
	if mode&fs.ModeSticky != 0 {
		if out[9] == 'x' {
			out[9] = 't'
		} else {
			out[9] = 'T'
		}
	}
	return string(out)
}

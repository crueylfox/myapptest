package sftpmanager

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const (
	sftpSourceTypeFile      = "file"
	sftpSourceTypeDirectory = "directory"
)

type RecursivePlanEntry struct {
	RelativePath string
	LocalPath    string
	RemotePath   string
	Size         int64
}

type RecursiveTransferPlan struct {
	Directories  []RecursivePlanEntry
	Files        []RecursivePlanEntry
	TotalBytes   int64
	SkippedCount int
	Warnings     []string
}

func PlanRecursiveUpload(ctx context.Context, localRoot, remoteDirectory string) (RecursiveTransferPlan, error) {
	localRoot = filepath.Clean(strings.TrimSpace(localRoot))
	if localRoot == "" || localRoot == "." {
		return RecursiveTransferPlan{}, errors.New("请选择要上传的本地文件夹")
	}
	if abs, err := filepath.Abs(localRoot); err == nil {
		localRoot = abs
	}
	info, err := os.Lstat(localRoot)
	if err != nil {
		return RecursiveTransferPlan{}, fmt.Errorf("本地文件夹不可读取: %w", err)
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return RecursiveTransferPlan{}, errors.New("暂不支持上传符号链接文件夹")
	}
	if !info.IsDir() {
		return RecursiveTransferPlan{}, errors.New("请选择本地文件夹")
	}
	rootName := filepath.Base(localRoot)
	if rootName == "." || rootName == string(filepath.Separator) || rootName == "" {
		return RecursiveTransferPlan{}, errors.New("本地文件夹名称不可用")
	}
	if hasParentTraversal(remoteDirectory) {
		return RecursiveTransferPlan{}, errors.New("远程目标路径不能包含 ..")
	}
	remoteRoot := joinRemotePath(cleanRemotePath(remoteDirectory), rootName)
	var plan RecursiveTransferPlan
	err = filepath.WalkDir(localRoot, func(current string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			if sameLocalPath(current, localRoot) {
				return fmt.Errorf("扫描本地文件夹失败: %w", walkErr)
			}
			plan.Warnings = append(plan.Warnings, safePathWarning("跳过不可读本地项目", current, walkErr))
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry == nil {
			return nil
		}
		if entry.Type()&fs.ModeSymlink != 0 {
			plan.SkippedCount++
			plan.Warnings = append(plan.Warnings, safePathWarning("跳过符号链接", current, nil))
			return nil
		}
		rel, err := filepath.Rel(localRoot, current)
		if err != nil {
			plan.Warnings = append(plan.Warnings, safePathWarning("跳过无法计算相对路径的本地项目", current, err))
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		remotePath, err := uploadRemotePath(remoteRoot, rel)
		if err != nil {
			plan.Warnings = append(plan.Warnings, safePathWarning("跳过不安全的本地项目", current, err))
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			plan.Directories = append(plan.Directories, RecursivePlanEntry{
				RelativePath: filepath.ToSlash(rel),
				LocalPath:    current,
				RemotePath:   remotePath,
			})
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			plan.SkippedCount++
			plan.Warnings = append(plan.Warnings, safePathWarning("跳过不可读取本地文件", current, err))
			return nil
		}
		plan.Files = append(plan.Files, RecursivePlanEntry{
			RelativePath: filepath.ToSlash(rel),
			LocalPath:    current,
			RemotePath:   remotePath,
			Size:         info.Size(),
		})
		plan.TotalBytes += info.Size()
		return nil
	})
	if err != nil {
		return RecursiveTransferPlan{}, err
	}
	return plan, nil
}

func PlanRecursiveDownload(ctx context.Context, client Client, remoteRoot, localDirectory string) (RecursiveTransferPlan, error) {
	if client == nil {
		return RecursiveTransferPlan{}, errors.New("SFTP 会话不可用")
	}
	if hasParentTraversal(remoteRoot) {
		return RecursiveTransferPlan{}, errors.New("远程源路径不能包含 ..")
	}
	remoteRoot = cleanRemotePath(remoteRoot)
	localDirectory = filepath.Clean(strings.TrimSpace(localDirectory))
	if localDirectory == "" || localDirectory == "." {
		return RecursiveTransferPlan{}, errors.New("请选择本地保存目录")
	}
	if abs, err := filepath.Abs(localDirectory); err == nil {
		localDirectory = abs
	}
	rootName := safeDownloadRootName(remoteRoot)
	localRoot := filepath.Join(localDirectory, rootName)
	if err := ensureLocalDescendant(localDirectory, localRoot); err != nil {
		return RecursiveTransferPlan{}, err
	}
	plan := RecursiveTransferPlan{
		Directories: []RecursivePlanEntry{{
			RelativePath: ".",
			LocalPath:    localRoot,
			RemotePath:   remoteRoot,
		}},
	}
	if err := planRemoteDirectory(ctx, client, remoteRoot, localRoot, ".", true, &plan); err != nil {
		return RecursiveTransferPlan{}, err
	}
	return plan, nil
}

func planRemoteDirectory(
	ctx context.Context,
	client Client,
	remotePath string,
	localPath string,
	relativePath string,
	root bool,
	plan *RecursiveTransferPlan,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	entries, err := client.ReadDir(ctx, remotePath)
	if err != nil {
		if root {
			return fmt.Errorf("扫描远程目录失败: %w", err)
		}
		plan.Warnings = append(plan.Warnings, safePathWarning("跳过不可读取远程目录", remotePath, err))
		plan.SkippedCount++
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
		if name == "." || name == ".." || strings.Contains(name, "/") || strings.Contains(name, "\\") {
			plan.Warnings = append(plan.Warnings, safePathWarning("跳过不安全远程名称", name, nil))
			plan.SkippedCount++
			continue
		}
		childRemote := joinRemotePath(remotePath, name)
		childRelative := joinRelativePath(relativePath, name)
		childLocal, err := safeLocalJoin(localPath, name)
		if err != nil {
			plan.Warnings = append(plan.Warnings, safePathWarning("跳过不安全本地目标", name, err))
			plan.SkippedCount++
			continue
		}
		if entry.Mode()&fs.ModeSymlink != 0 {
			plan.Warnings = append(plan.Warnings, safePathWarning("跳过远程符号链接", childRemote, nil))
			plan.SkippedCount++
			continue
		}
		if entry.IsDir() {
			plan.Directories = append(plan.Directories, RecursivePlanEntry{
				RelativePath: childRelative,
				LocalPath:    childLocal,
				RemotePath:   childRemote,
			})
			if err := planRemoteDirectory(ctx, client, childRemote, childLocal, childRelative, false, plan); err != nil {
				return err
			}
			continue
		}
		plan.Files = append(plan.Files, RecursivePlanEntry{
			RelativePath: childRelative,
			LocalPath:    childLocal,
			RemotePath:   childRemote,
			Size:         entry.Size(),
		})
		plan.TotalBytes += entry.Size()
	}
	return nil
}

func uploadRemotePath(remoteRoot, relativePath string) (string, error) {
	relativePath = filepath.ToSlash(relativePath)
	if relativePath == "" || relativePath == "." {
		return cleanRemotePath(remoteRoot), nil
	}
	if hasParentTraversal(relativePath) || strings.HasPrefix(relativePath, "/") {
		return "", errors.New("相对路径不安全")
	}
	return joinRemotePath(remoteRoot, relativePath), nil
}

func safeLocalJoin(parent string, name string) (string, error) {
	if name == "" || name == "." || name == ".." || strings.Contains(name, "/") || strings.Contains(name, "\\") {
		return "", errors.New("本地目标名称不安全")
	}
	target := filepath.Join(parent, name)
	if err := ensureLocalDescendant(parent, target); err != nil {
		return "", err
	}
	return target, nil
}

func ensureLocalDescendant(root, target string) error {
	rootAbs, err := filepath.Abs(filepath.Clean(root))
	if err != nil {
		return fmt.Errorf("本地根目录无效: %w", err)
	}
	targetAbs, err := filepath.Abs(filepath.Clean(target))
	if err != nil {
		return fmt.Errorf("本地目标路径无效: %w", err)
	}
	rel, err := filepath.Rel(rootAbs, targetAbs)
	if err != nil {
		return fmt.Errorf("本地路径关系无效: %w", err)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return errors.New("本地目标路径越界")
	}
	return nil
}

func hasParentTraversal(value string) bool {
	value = strings.ReplaceAll(value, "\\", "/")
	for _, part := range strings.Split(value, "/") {
		if part == ".." {
			return true
		}
	}
	return false
}

func joinRelativePath(parent, name string) string {
	if parent == "" || parent == "." {
		return name
	}
	return path.Clean(parent + "/" + name)
}

func safeDownloadRootName(remoteRoot string) string {
	name := baseRemotePath(remoteRoot)
	if name == "" || name == "." || name == "/" || name == ".." {
		return "remote-root"
	}
	return strings.ReplaceAll(strings.ReplaceAll(name, "/", "_"), "\\", "_")
}

func safePathWarning(prefix, pathValue string, err error) string {
	name := filepath.Base(pathValue)
	if strings.Contains(pathValue, "/") {
		name = path.Base(strings.ReplaceAll(pathValue, "\\", "/"))
	}
	if name == "." || name == string(filepath.Separator) || name == "/" || name == "" {
		name = "项目"
	}
	if err == nil {
		return fmt.Sprintf("%s：%s", prefix, name)
	}
	return fmt.Sprintf("%s：%s（%s）", prefix, name, sanitizeError(err))
}

func sanitizeError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	message = strings.ReplaceAll(message, "\r", " ")
	message = strings.ReplaceAll(message, "\n", " ")
	if len(message) > 160 {
		return message[:160] + "..."
	}
	return message
}

func sameLocalPath(left, right string) bool {
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	if leftErr == nil && rightErr == nil {
		return filepath.Clean(leftAbs) == filepath.Clean(rightAbs)
	}
	return filepath.Clean(left) == filepath.Clean(right)
}

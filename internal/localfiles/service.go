package localfiles

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"hostdeck/internal/domain"
)

type Provider interface {
	HomeDir() (string, error)
	Drives() ([]domain.LocalDrive, error)
	ListDirectory(path string) ([]domain.LocalFileEntry, error)
}

type ShellExecutor interface {
	Open(path string) error
	Reveal(path string) error
	Properties(path string) error
}

type Service struct {
	provider Provider
	shell    ShellExecutor
}

func New(provider Provider) *Service {
	return NewWithShell(provider, nil)
}

func NewWithShell(provider Provider, shell ShellExecutor) *Service {
	if provider == nil {
		provider = OSProvider{}
	}
	if shell == nil {
		shell = OSShellExecutor{}
	}
	return &Service{provider: provider, shell: shell}
}

func (s *Service) Home() (domain.LocalExplorerHome, error) {
	path, err := s.provider.HomeDir()
	if err != nil {
		return domain.LocalExplorerHome{}, mapLocalFileError("", err)
	}
	return domain.LocalExplorerHome{Path: cleanLocalPath(path)}, nil
}

func (s *Service) Drives() ([]domain.LocalDrive, error) {
	drives, err := s.provider.Drives()
	if err != nil {
		return nil, mapLocalFileError("", err)
	}
	sort.SliceStable(drives, func(i, j int) bool {
		return strings.ToLower(drives[i].Path) < strings.ToLower(drives[j].Path)
	})
	return drives, nil
}

func (s *Service) ListDirectory(request domain.LocalDirectoryRequest) (domain.LocalDirectoryListing, error) {
	path := cleanLocalPath(request.Path)
	if path == "" {
		home, err := s.Home()
		if err != nil {
			return domain.LocalDirectoryListing{}, err
		}
		path = home.Path
	}
	entries, err := s.provider.ListDirectory(path)
	if err != nil {
		return domain.LocalDirectoryListing{}, mapLocalFileError(path, err)
	}
	sortLocalEntries(entries)
	return domain.LocalDirectoryListing{
		Path:    path,
		Parent:  parentPath(path),
		Entries: entries,
	}, nil
}

func (s *Service) OpenPath(request domain.LocalPathRequest) error {
	path, err := existingLocalPath(request.Path)
	if err != nil {
		return mapLocalFileError(path, err)
	}
	return mapLocalFileError(path, s.shell.Open(path))
}

func (s *Service) RevealPath(request domain.LocalPathRequest) error {
	path, err := existingLocalPath(request.Path)
	if err != nil {
		return mapLocalFileError(path, err)
	}
	return mapLocalFileError(path, s.shell.Reveal(path))
}

func (s *Service) ShowProperties(request domain.LocalPathRequest) error {
	path, err := existingLocalPath(request.Path)
	if err != nil {
		return mapLocalFileError(path, err)
	}
	return mapLocalFileError(path, s.shell.Properties(path))
}

type OSProvider struct{}

func (OSProvider) HomeDir() (string, error) {
	return os.UserHomeDir()
}

func (OSProvider) Drives() ([]domain.LocalDrive, error) {
	drives := make([]domain.LocalDrive, 0, 4)
	for letter := 'A'; letter <= 'Z'; letter++ {
		path := string(letter) + `:\`
		if _, err := os.Stat(path); err == nil {
			drives = append(drives, domain.LocalDrive{Name: string(letter) + ":", Path: path})
		}
	}
	return drives, nil
}

func (OSProvider) ListDirectory(path string) ([]domain.LocalFileEntry, error) {
	rows, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	entries := make([]domain.LocalFileEntry, 0, len(rows))
	for _, row := range rows {
		info, err := row.Info()
		if err != nil {
			continue
		}
		entries = append(entries, domain.LocalFileEntry{
			Name:        row.Name(),
			Path:        filepath.Join(path, row.Name()),
			Size:        fileSize(info),
			IsDir:       row.IsDir(),
			ModTime:     info.ModTime().Format(time.RFC3339),
			DisplayType: displayType(row),
		})
	}
	return entries, nil
}

func fileSize(info os.FileInfo) int64 {
	if info.IsDir() {
		return 0
	}
	return info.Size()
}

func displayType(entry os.DirEntry) string {
	if entry.IsDir() {
		return "folder"
	}
	return "file"
}

func cleanLocalPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	return filepath.Clean(path)
}

func existingLocalPath(path string) (string, error) {
	cleaned := cleanLocalPath(path)
	if cleaned == "" {
		return cleaned, os.ErrNotExist
	}
	if _, err := os.Stat(cleaned); err != nil {
		return cleaned, err
	}
	return cleaned, nil
}

func parentPath(path string) string {
	parent := filepath.Dir(path)
	if parent == "." || parent == path {
		return ""
	}
	return parent
}

func sortLocalEntries(entries []domain.LocalFileEntry) {
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
}

func mapLocalFileError(path string, err error) error {
	if err == nil {
		return nil
	}
	code := "failed"
	if errors.Is(err, os.ErrNotExist) || strings.Contains(strings.ToLower(err.Error()), "not found") {
		code = "not_found"
	} else if errors.Is(err, os.ErrPermission) || strings.Contains(strings.ToLower(err.Error()), "permission") || strings.Contains(strings.ToLower(err.Error()), "access is denied") {
		code = "permission_denied"
	}
	return &domain.LocalFileError{
		Code:    code,
		Message: err.Error(),
		Path:    path,
	}
}

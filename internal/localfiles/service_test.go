package localfiles

import (
	"errors"
	"os"
	"testing"
	"time"

	"serverpilot/internal/domain"
)

type fakeEntry struct {
	name    string
	path    string
	size    int64
	isDir   bool
	modTime time.Time
}

type fakeProvider struct {
	home    string
	drives  []domain.LocalDrive
	entries map[string][]fakeEntry
	errs    map[string]error
}

func (p *fakeProvider) HomeDir() (string, error) {
	return p.home, nil
}

func (p *fakeProvider) Drives() ([]domain.LocalDrive, error) {
	return p.drives, nil
}

func (p *fakeProvider) ListDirectory(path string) ([]domain.LocalFileEntry, error) {
	if err := p.errs[path]; err != nil {
		return nil, err
	}
	rows := p.entries[path]
	result := make([]domain.LocalFileEntry, 0, len(rows))
	for _, row := range rows {
		result = append(result, domain.LocalFileEntry{
			Name:        row.name,
			Path:        row.path,
			Size:        row.size,
			IsDir:       row.isDir,
			ModTime:     row.modTime.Format(time.RFC3339),
			DisplayType: map[bool]string{true: "folder", false: "file"}[row.isDir],
		})
	}
	return result, nil
}

func TestServiceListsDirectoryWithCleanedPathAndDirectoriesFirst(t *testing.T) {
	provider := &fakeProvider{
		home: "C:\\Users\\Tester",
		entries: map[string][]fakeEntry{
			"C:\\Users\\Tester\\Documents": {
				{name: "zeta.txt", path: "C:\\Users\\Tester\\Documents\\zeta.txt", size: 12},
				{name: "alpha", path: "C:\\Users\\Tester\\Documents\\alpha", isDir: true},
			},
		},
	}
	service := New(provider)

	listing, err := service.ListDirectory(domain.LocalDirectoryRequest{
		Path: "C:\\Users\\Tester\\Documents\\..\\Documents\\",
	})
	if err != nil {
		t.Fatalf("ListDirectory returned error: %v", err)
	}

	if listing.Path != "C:\\Users\\Tester\\Documents" {
		t.Fatalf("Path = %q, want cleaned Documents path", listing.Path)
	}
	if len(listing.Entries) != 2 {
		t.Fatalf("Entries length = %d, want 2", len(listing.Entries))
	}
	if !listing.Entries[0].IsDir || listing.Entries[0].Name != "alpha" {
		t.Fatalf("first entry = %#v, want alpha directory first", listing.Entries[0])
	}
}

func TestServiceReturnsTypedNotFoundError(t *testing.T) {
	provider := &fakeProvider{
		home: "C:\\Users\\Tester",
		errs: map[string]error{
			"C:\\Users\\Tester\\Missing": errors.New("not found"),
		},
	}
	service := New(provider)

	_, err := service.ListDirectory(domain.LocalDirectoryRequest{Path: "C:\\Users\\Tester\\Missing"})
	var localErr *domain.LocalFileError
	if !errors.As(err, &localErr) {
		t.Fatalf("error = %T %[1]v, want *domain.LocalFileError", err)
	}
	if localErr.Code != "not_found" {
		t.Fatalf("code = %q, want not_found", localErr.Code)
	}
}

func TestServiceReturnsHomeAndDrivesWithoutListingFileContents(t *testing.T) {
	provider := &fakeProvider{
		home: "C:\\Users\\Tester",
		drives: []domain.LocalDrive{
			{Name: "C:", Path: "C:\\"},
			{Name: "D:", Path: "D:\\"},
		},
	}
	service := New(provider)

	home, err := service.Home()
	if err != nil {
		t.Fatalf("Home returned error: %v", err)
	}
	if home.Path != "C:\\Users\\Tester" {
		t.Fatalf("home path = %q", home.Path)
	}
	drives, err := service.Drives()
	if err != nil {
		t.Fatalf("Drives returned error: %v", err)
	}
	if len(drives) != 2 || drives[0].Path != "C:\\" || drives[1].Path != "D:\\" {
		t.Fatalf("drives = %#v", drives)
	}
}

type fakeShellExecutor struct {
	opened     []string
	revealed   []string
	properties []string
}

func (e *fakeShellExecutor) Open(path string) error {
	e.opened = append(e.opened, path)
	return nil
}

func (e *fakeShellExecutor) Reveal(path string) error {
	e.revealed = append(e.revealed, path)
	return nil
}

func (e *fakeShellExecutor) Properties(path string) error {
	e.properties = append(e.properties, path)
	return nil
}

func TestServiceUsesShellExecutorForLocalPathActions(t *testing.T) {
	root := t.TempDir()
	filePath := root + "\\fixture.txt"
	if err := os.WriteFile(filePath, []byte("fixture"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	executor := &fakeShellExecutor{}
	service := NewWithShell(&fakeProvider{home: root}, executor)

	if err := service.OpenPath(domain.LocalPathRequest{Path: filePath}); err != nil {
		t.Fatalf("OpenPath returned error: %v", err)
	}
	if err := service.RevealPath(domain.LocalPathRequest{Path: filePath}); err != nil {
		t.Fatalf("RevealPath returned error: %v", err)
	}
	if err := service.ShowProperties(domain.LocalPathRequest{Path: filePath}); err != nil {
		t.Fatalf("ShowProperties returned error: %v", err)
	}

	if len(executor.opened) != 1 || executor.opened[0] != filePath {
		t.Fatalf("opened = %#v", executor.opened)
	}
	if len(executor.revealed) != 1 || executor.revealed[0] != filePath {
		t.Fatalf("revealed = %#v", executor.revealed)
	}
	if len(executor.properties) != 1 || executor.properties[0] != filePath {
		t.Fatalf("properties = %#v", executor.properties)
	}
}

func TestServiceReturnsTypedNotFoundForMissingLocalPathAction(t *testing.T) {
	root := t.TempDir()
	service := NewWithShell(&fakeProvider{home: root}, &fakeShellExecutor{})

	err := service.OpenPath(domain.LocalPathRequest{Path: root + "\\missing.txt"})
	var localErr *domain.LocalFileError
	if !errors.As(err, &localErr) {
		t.Fatalf("error = %T %[1]v, want *domain.LocalFileError", err)
	}
	if localErr.Code != "not_found" {
		t.Fatalf("code = %q, want not_found", localErr.Code)
	}
}

package sftpmanager

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestManagerGoKeepsOnlyCoreWiringAfterDomainSplit(t *testing.T) {
	t.Parallel()

	methods := declaredManagerMethods(t, "manager.go")
	for _, method := range []string{
		"Open",
		"Reconnect",
		"List",
		"ReadTextFile",
		"WriteTextFile",
		"GetItemProperties",
		"UpdateItemPermissions",
		"Upload",
		"Download",
		"Stop",
	} {
		if methods[method] {
			t.Fatalf("manager.go still owns %s; move domain Manager methods into manager_*.go files", method)
		}
	}

	source, err := os.ReadFile("manager.go")
	if err != nil {
		t.Fatalf("read manager.go: %v", err)
	}
	text := string(source)
	for _, required := range []string{"type Manager struct", "func New(", "func NewWithDialer("} {
		if !strings.Contains(text, required) {
			t.Fatalf("manager.go should retain core wiring %q", required)
		}
	}
}

func TestManagerDomainSplitFilesExist(t *testing.T) {
	t.Parallel()

	for _, file := range []string{
		"manager_browse.go",
		"manager_conflict.go",
		"manager_errors.go",
		"manager_events.go",
		"manager_helpers.go",
		"manager_paths.go",
		"manager_properties.go",
		"manager_scp.go",
		"manager_session.go",
		"manager_text.go",
		"manager_transfer.go",
	} {
		if _, err := os.Stat(file); err != nil {
			t.Fatalf("expected split manager file %s: %v", file, err)
		}
	}
}

func TestManagerRepresentativeExportedSurfaceRemains(t *testing.T) {
	t.Parallel()

	managerType := reflect.TypeOf((*Manager)(nil))
	for _, method := range []string{
		"Open",
		"Reconnect",
		"State",
		"List",
		"Home",
		"Parent",
		"Mkdir",
		"Rename",
		"Stat",
		"GetItemProperties",
		"UpdateItemPermissions",
		"ReadTextFile",
		"WriteTextFile",
		"Upload",
		"Download",
		"UploadDirectory",
		"DownloadDirectory",
		"CancelTransfer",
		"PauseTransfer",
		"ResumeTransfer",
		"Stop",
		"StopContext",
		"StopAll",
		"IsActive",
	} {
		if _, ok := managerType.MethodByName(method); !ok {
			t.Fatalf("Manager exported method %s is missing", method)
		}
	}
}

func declaredManagerMethods(t *testing.T, filename string) map[string]bool {
	t.Helper()

	file, err := parser.ParseFile(token.NewFileSet(), filename, nil, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", filename, err)
	}
	methods := make(map[string]bool)
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Recv == nil || len(fn.Recv.List) == 0 {
			continue
		}
		if isManagerReceiver(fn.Recv.List[0].Type) {
			methods[fn.Name.Name] = true
		}
	}
	return methods
}

func isManagerReceiver(expr ast.Expr) bool {
	switch value := expr.(type) {
	case *ast.StarExpr:
		return isManagerReceiver(value.X)
	case *ast.Ident:
		return value.Name == "Manager"
	default:
		return false
	}
}

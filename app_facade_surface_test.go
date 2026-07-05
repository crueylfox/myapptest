package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"reflect"
	"testing"
)

func TestAppFacadeSurfaceRetainsRepresentativeMethods(t *testing.T) {
	appType := reflect.TypeOf(&App{})
	methods := []string{
		"GetAppVersion",
		"GetDefaultSettings",
		"CheckShortcutConflicts",
		"ListConnections",
		"ProbeConnectionReachability",
		"OpenTerminal",
		"ReconnectTerminal",
		"WriteTerminal",
		"OpenLocalTerminal",
		"GetLocalResourceSnapshot",
		"ListLocalDirectory",
		"SftpReadTextFile",
		"SftpWriteTextFile",
		"SftpGetRemoteItemProperties",
		"SftpUpdateRemoteItemPermissions",
		"ImportBackup",
		"ListKeyVaultEntries",
		"GetMonitorSnapshot",
		"DockerCheck",
		"ListProcesses",
		"CheckServiceManager",
		"OpenNetworkInspectionContext",
		"ListTunnels",
		"ListCommandHistory",
	}

	for _, name := range methods {
		if _, ok := appType.MethodByName(name); !ok {
			t.Fatalf("*App is missing Wails facade method %s", name)
		}
	}
}

func TestAppGoDoesNotOwnDomainFacadeMethods(t *testing.T) {
	fileSet := token.NewFileSet()
	parsed, err := parser.ParseFile(fileSet, "app.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}

	var exportedAppMethods []string
	for _, declaration := range parsed.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Recv == nil || !function.Name.IsExported() {
			continue
		}
		if receiverIsAppPointer(function.Recv) {
			exportedAppMethods = append(exportedAppMethods, function.Name.Name)
		}
	}

	if len(exportedAppMethods) > 0 {
		t.Fatalf("app.go still owns exported App facade methods: %v", exportedAppMethods)
	}
}

func receiverIsAppPointer(receiver *ast.FieldList) bool {
	if receiver == nil || len(receiver.List) != 1 {
		return false
	}
	pointer, ok := receiver.List[0].Type.(*ast.StarExpr)
	if !ok {
		return false
	}
	identifier, ok := pointer.X.(*ast.Ident)
	return ok && identifier.Name == "App"
}

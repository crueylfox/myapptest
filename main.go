package main

import (
	"embed"
	"os"
	"runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"hostdeck/internal/domain"
)

//go:embed all:frontend/dist
var assets embed.FS

func stableWindowsWebviewUserDataPath() string {
	configDir, err := os.UserConfigDir()
	if err != nil || configDir == "" {
		configDir = os.Getenv("APPDATA")
	}
	if configDir == "" {
		configDir = os.TempDir()
	}
	_ = migrateLegacyAppDataDir(configDir)
	return hostDeckWebviewUserDataPath(configDir)
}

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "HostDeck",
		Width:     domain.DefaultWindowWidth,
		Height:    domain.DefaultWindowHeight,
		MinWidth:  minWindowWidth,
		MinHeight: minWindowHeight,
		Frameless: runtime.GOOS == "windows",
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
		},
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
		},
		Windows: &windows.Options{
			WebviewUserDataPath: stableWindowsWebviewUserDataPath(),
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

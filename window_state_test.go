package main

import (
	"testing"

	"serverpilot/internal/domain"
)

func TestAdaptiveDefaultWindowSizeUsesDisplayRatio(t *testing.T) {
	tests := []struct {
		name                      string
		screenWidth, screenHeight int
		wantWidth, wantHeight     int
	}{
		{name: "3840 by 2160", screenWidth: 3840, screenHeight: 2160, wantWidth: 1920, wantHeight: 1512},
		{name: "2560 by 1440", screenWidth: 2560, screenHeight: 1440, wantWidth: 1280, wantHeight: 1008},
		{name: "small screen clamps to work area", screenWidth: 1024, screenHeight: 700, wantWidth: 900, wantHeight: 600},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			width, height := adaptiveDefaultWindowSize(test.screenWidth, test.screenHeight)
			if width != test.wantWidth || height != test.wantHeight {
				t.Fatalf("adaptive default=%dx%d want=%dx%d", width, height, test.wantWidth, test.wantHeight)
			}
		})
	}
}

func TestClampWindowSizePreservesSavedSizeWithinWorkArea(t *testing.T) {
	tests := []struct {
		name                      string
		width, height             int
		screenWidth, screenHeight int
		wantWidth, wantHeight     int
	}{
		{name: "saved size remains preferred", width: 1440, height: 900, screenWidth: 2560, screenHeight: 1600, wantWidth: 1440, wantHeight: 900},
		{name: "saved too large clamps to screen margin", width: 2500, height: 1700, screenWidth: 1920, screenHeight: 1080, wantWidth: 1872, wantHeight: 1032},
		{name: "saved too small clamps to app minimum", width: 640, height: 480, screenWidth: 1920, screenHeight: 1080, wantWidth: 900, wantHeight: 600},
		{name: "unknown screen keeps saved values", width: 1280, height: 720, wantWidth: 1280, wantHeight: 720},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			width, height := clampWindowSize(test.width, test.height, test.screenWidth, test.screenHeight)
			if width != test.wantWidth || height != test.wantHeight {
				t.Fatalf("size=%dx%d want=%dx%d", width, height, test.wantWidth, test.wantHeight)
			}
		})
	}
}

func TestLegacyDefaultSizesAreNotTreatedAsSavedWindowState(t *testing.T) {
	settings := domain.DefaultAppSettings()
	if state, ok := legacyWindowState(settings); ok {
		t.Fatalf("current default should not be treated as saved state: %+v", state)
	}

	settings.WindowWidth = legacyDefaultWidth
	settings.WindowHeight = legacyDefaultHeight
	if state, ok := legacyWindowState(settings); ok {
		t.Fatalf("old +30%% default should not be treated as saved state: %+v", state)
	}

	settings.WindowWidth = 1180
	settings.WindowHeight = 820
	state, ok := legacyWindowState(settings)
	if !ok || state.Width != 1180 || state.Height != 820 {
		t.Fatalf("custom legacy window was not preserved: ok=%v state=%+v", ok, state)
	}
}

func TestDefaultAppSettingsKeepCompatibilityFallbackOnly(t *testing.T) {
	defaults := domain.DefaultAppSettings()
	if domain.DefaultWindowHeight != 1500 || defaults.WindowHeight != 1500 {
		t.Fatalf("fixed fallback height should stay 1500: domain=%d settings=%d", domain.DefaultWindowHeight, defaults.WindowHeight)
	}
	if domain.DefaultWindowWidth != 1360 || defaults.WindowWidth != domain.DefaultWindowWidth {
		t.Fatalf("fallback width changed: domain=%d settings=%d", domain.DefaultWindowWidth, defaults.WindowWidth)
	}
	if defaults.WindowMaximized {
		t.Fatal("default window must not force maximized mode")
	}
}

func TestClampWindowBoundsRecentersOffscreenSavedPosition(t *testing.T) {
	state := clampWindowBounds(domain.WindowState{X: 5000, Y: -40, Width: 1180, Height: 820}, 2560, 1440)
	if state.Width != 1180 || state.Height != 820 {
		t.Fatalf("saved size changed unexpectedly: %+v", state)
	}
	if state.X != (2560-1180)/2 || state.Y != (1440-820)/2 {
		t.Fatalf("offscreen position not recentered: %+v", state)
	}
}

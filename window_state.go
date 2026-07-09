package main

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"hostdeck/internal/domain"
	"hostdeck/internal/persistence"
)

const (
	minWindowWidth        = 900
	minWindowHeight       = 600
	screenMargin          = 48
	legacyDefaultWidth    = 1360
	legacyDefaultHeight   = 1950
	offscreenVisibleInset = 64
)

type windowStateStore interface {
	GetWindowState(context.Context) (domain.WindowState, bool, error)
	SaveWindowState(context.Context, domain.WindowState) error
}

func adaptiveDefaultWindowSize(screenWidth, screenHeight int) (int, int) {
	width := domain.DefaultWindowWidth
	height := domain.DefaultWindowHeight
	if screenWidth > 0 {
		width = int(math.Round(float64(screenWidth) * 0.50))
	}
	if screenHeight > 0 {
		height = int(math.Round(float64(screenHeight) * 0.70))
	}
	return clampWindowSize(width, height, screenWidth, screenHeight)
}

func clampWindowSize(width, height, screenWidth, screenHeight int) (int, int) {
	if width < 1 {
		width = domain.DefaultWindowWidth
	}
	if height < 1 {
		height = domain.DefaultWindowHeight
	}
	if screenWidth < 1 || screenHeight < 1 {
		return width, height
	}
	maxWidth := max(screenWidth-screenMargin, 640)
	maxHeight := max(screenHeight-screenMargin, 480)
	minWidth := min(minWindowWidth, maxWidth)
	minHeight := min(minWindowHeight, maxHeight)
	return min(max(width, minWidth), maxWidth), min(max(height, minHeight), maxHeight)
}

func clampWindowBounds(state domain.WindowState, screenWidth, screenHeight int) domain.WindowState {
	state.Width, state.Height = clampWindowSize(state.Width, state.Height, screenWidth, screenHeight)
	if screenWidth < 1 || screenHeight < 1 {
		return state
	}
	centerX := max((screenWidth-state.Width)/2, 0)
	centerY := max((screenHeight-state.Height)/2, 0)
	if state.X < 0 || state.X > screenWidth-offscreenVisibleInset {
		state.X = centerX
	} else {
		state.X = min(max(state.X, 0), max(screenWidth-state.Width, 0))
	}
	if state.Y < 0 || state.Y > screenHeight-offscreenVisibleInset {
		state.Y = centerY
	} else {
		state.Y = min(max(state.Y, 0), max(screenHeight-state.Height, 0))
	}
	return state
}

func preferredScreen(screens []runtime.Screen) (int, int, string) {
	for _, screen := range screens {
		if screen.IsCurrent {
			return screen.Size.Width, screen.Size.Height, "current"
		}
	}
	for _, screen := range screens {
		if screen.IsPrimary {
			return screen.Size.Width, screen.Size.Height, "primary"
		}
	}
	if len(screens) > 0 {
		return screens[0].Size.Width, screens[0].Size.Height, "screen-0"
	}
	return 0, 0, ""
}

func legacyWindowState(value domain.AppSettings) (domain.WindowState, bool) {
	if value.WindowMaximized {
		return domain.WindowState{
			Width:       value.WindowWidth,
			Height:      value.WindowHeight,
			IsMaximized: true,
		}, true
	}
	if value.WindowWidth == legacyDefaultWidth && value.WindowHeight == legacyDefaultHeight {
		return domain.WindowState{}, false
	}
	if value.WindowWidth == domain.DefaultWindowWidth && value.WindowHeight == domain.DefaultWindowHeight {
		return domain.WindowState{}, false
	}
	if value.WindowWidth < 640 || value.WindowHeight < 480 {
		return domain.WindowState{}, false
	}
	return domain.WindowState{
		Width:  value.WindowWidth,
		Height: value.WindowHeight,
	}, true
}

func validWindowState(state domain.WindowState) bool {
	return state.Width >= 640 && state.Height >= 480
}

func restoreWindowState(ctx context.Context, store windowStateStore, value domain.AppSettings) error {
	screens, err := runtime.ScreenGetAll(ctx)
	screenWidth, screenHeight, monitorID := preferredScreen(screens)
	var state domain.WindowState
	restored := false
	useSavedPosition := false
	if store != nil {
		if saved, ok, readErr := store.GetWindowState(ctx); readErr != nil {
			return readErr
		} else if ok && validWindowState(saved) {
			state = saved
			restored = true
			useSavedPosition = true
		}
	}
	if !restored {
		if legacy, ok := legacyWindowState(value); ok {
			state = legacy
			state.MonitorID = monitorID
			restored = true
		}
	}
	if !restored {
		width, height := adaptiveDefaultWindowSize(screenWidth, screenHeight)
		state = domain.WindowState{
			Width:     width,
			Height:    height,
			MonitorID: monitorID,
		}
	}
	state = clampWindowBounds(state, screenWidth, screenHeight)
	runtime.WindowSetSize(ctx, state.Width, state.Height)
	if useSavedPosition {
		runtime.WindowSetPosition(ctx, state.X, state.Y)
	} else {
		runtime.WindowCenter(ctx)
	}
	if state.IsMaximized {
		runtime.WindowMaximise(ctx)
	}
	return err
}

func persistWindowState(ctx context.Context, store *persistence.Store) (err error) {
	if store == nil {
		return errors.New("persistence store is not initialized")
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("window runtime unavailable during shutdown: %v", recovered)
		}
	}()
	if runtime.WindowIsMinimised(ctx) {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	maximized := runtime.WindowIsMaximised(ctx)
	state, ok, err := store.GetWindowState(ctx)
	if err != nil {
		return err
	}
	if !maximized || !ok || !validWindowState(state) {
		state.X, state.Y = runtime.WindowGetPosition(ctx)
		state.Width, state.Height = runtime.WindowGetSize(ctx)
	}
	state.IsMaximized = maximized
	state.MonitorID = "current"
	state.UpdatedAt = now
	if !validWindowState(state) {
		return nil
	}
	return store.SaveWindowState(ctx, state)
}

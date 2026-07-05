package domain

import (
	"errors"
	"regexp"
	"strings"
)

const DefaultTerminalProfileID = "default"

type TerminalCursorStyle string

const (
	TerminalCursorBlock     TerminalCursorStyle = "block"
	TerminalCursorUnderline TerminalCursorStyle = "underline"
	TerminalCursorBar       TerminalCursorStyle = "bar"
)

type TerminalThemeName string

const (
	TerminalThemeServerPilotDark TerminalThemeName = "serverpilot-dark"
	TerminalThemeClassicDark     TerminalThemeName = "classic-dark"
	TerminalThemeLight           TerminalThemeName = "light"
	TerminalThemeCustom          TerminalThemeName = "custom"
)

type TerminalProfile struct {
	ID                  string              `json:"id"`
	Name                string              `json:"name"`
	FontFamily          string              `json:"fontFamily"`
	FontSize            int                 `json:"fontSize"`
	LineHeight          float64             `json:"lineHeight"`
	LetterSpacing       float64             `json:"letterSpacing"`
	CursorStyle         TerminalCursorStyle `json:"cursorStyle"`
	CursorBlink         bool                `json:"cursorBlink"`
	Scrollback          int                 `json:"scrollback"`
	ThemeName           TerminalThemeName   `json:"themeName"`
	Foreground          string              `json:"foreground"`
	Background          string              `json:"background"`
	SelectionBackground string              `json:"selectionBackground"`
	CursorColor         string              `json:"cursorColor"`
	CreatedAt           string              `json:"createdAt"`
	UpdatedAt           string              `json:"updatedAt"`
}

type SaveTerminalProfileRequest struct {
	ID                  string              `json:"id"`
	Name                string              `json:"name"`
	FontFamily          string              `json:"fontFamily"`
	FontSize            int                 `json:"fontSize"`
	LineHeight          float64             `json:"lineHeight"`
	LetterSpacing       float64             `json:"letterSpacing"`
	CursorStyle         TerminalCursorStyle `json:"cursorStyle"`
	CursorBlink         bool                `json:"cursorBlink"`
	Scrollback          int                 `json:"scrollback"`
	ThemeName           TerminalThemeName   `json:"themeName"`
	Foreground          string              `json:"foreground"`
	Background          string              `json:"background"`
	SelectionBackground string              `json:"selectionBackground"`
	CursorColor         string              `json:"cursorColor"`
}

type AssignServerTerminalProfileRequest struct {
	ServerID          int64   `json:"serverID"`
	TerminalProfileID *string `json:"terminalProfileId"`
}

type DeleteTerminalProfileRequest struct {
	ID                 string `json:"id"`
	ForceDetachServers bool   `json:"forceDetachServers"`
}

type DeleteTerminalProfileResponse struct {
	ID              string `json:"id"`
	DetachedServers int    `json:"detachedServers"`
}

type ResolveTerminalProfileRequest struct {
	ServerID int64 `json:"serverID"`
}

type BackupTerminalProfile struct {
	ID                  string              `json:"id"`
	Name                string              `json:"name"`
	FontFamily          string              `json:"fontFamily"`
	FontSize            int                 `json:"fontSize"`
	LineHeight          float64             `json:"lineHeight"`
	LetterSpacing       float64             `json:"letterSpacing"`
	CursorStyle         TerminalCursorStyle `json:"cursorStyle"`
	CursorBlink         bool                `json:"cursorBlink"`
	Scrollback          int                 `json:"scrollback"`
	ThemeName           TerminalThemeName   `json:"themeName"`
	Foreground          string              `json:"foreground"`
	Background          string              `json:"background"`
	SelectionBackground string              `json:"selectionBackground"`
	CursorColor         string              `json:"cursorColor"`
	CreatedAt           string              `json:"createdAt"`
	UpdatedAt           string              `json:"updatedAt"`
}

var terminalHexColorPattern = regexp.MustCompile(`^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`)
var terminalUnsafeFontFamilyPattern = regexp.MustCompile(`(?i)[;{}]|<\s*script`)

func DefaultTerminalProfile() TerminalProfile {
	return TerminalProfile{
		ID:                  DefaultTerminalProfileID,
		Name:                "默认",
		FontFamily:          "Consolas, Cascadia Mono, monospace",
		FontSize:            15,
		LineHeight:          1.2,
		LetterSpacing:       0,
		CursorStyle:         TerminalCursorBlock,
		CursorBlink:         true,
		Scrollback:          10000,
		ThemeName:           TerminalThemeServerPilotDark,
		Foreground:          "#dbeafe",
		Background:          "#07111f",
		SelectionBackground: "#2563eb66",
		CursorColor:         "#ffffff",
	}
}

func NormalizeTerminalProfileRequest(request SaveTerminalProfileRequest) SaveTerminalProfileRequest {
	request.ID = strings.TrimSpace(request.ID)
	request.Name = strings.TrimSpace(request.Name)
	request.FontFamily = strings.TrimSpace(request.FontFamily)
	request.Foreground = strings.TrimSpace(request.Foreground)
	request.Background = strings.TrimSpace(request.Background)
	request.SelectionBackground = strings.TrimSpace(request.SelectionBackground)
	request.CursorColor = strings.TrimSpace(request.CursorColor)
	if request.FontFamily == "" {
		request.FontFamily = DefaultTerminalProfile().FontFamily
	}
	if request.CursorStyle == "" {
		request.CursorStyle = TerminalCursorBlock
	}
	if request.ThemeName == "" {
		request.ThemeName = TerminalThemeServerPilotDark
	}
	return request
}

func ValidateTerminalProfile(request SaveTerminalProfileRequest) error {
	request = NormalizeTerminalProfileRequest(request)
	if request.Name == "" {
		return errors.New("终端配置名称不能为空")
	}
	if len([]rune(request.Name)) > 60 {
		return errors.New("终端配置名称最大 60 个字符")
	}
	if len([]rune(request.FontFamily)) > 120 {
		return errors.New("字体名称最大 120 个字符")
	}
	if terminalUnsafeFontFamilyPattern.MatchString(request.FontFamily) {
		return errors.New("字体名称包含不允许的字符")
	}
	if request.FontSize < 10 || request.FontSize > 28 {
		return errors.New("字体大小必须在 10 到 28 之间")
	}
	if request.LineHeight < 1.0 || request.LineHeight > 2.0 {
		return errors.New("行高必须在 1.0 到 2.0 之间")
	}
	if request.LetterSpacing < -1 || request.LetterSpacing > 4 {
		return errors.New("字间距必须在 -1 到 4 之间")
	}
	switch request.CursorStyle {
	case TerminalCursorBlock, TerminalCursorUnderline, TerminalCursorBar:
	default:
		return errors.New("光标样式无效")
	}
	if request.Scrollback < 1000 || request.Scrollback > 50000 {
		return errors.New("滚动缓冲行数必须在 1000 到 50000 之间")
	}
	switch request.ThemeName {
	case TerminalThemeServerPilotDark, TerminalThemeClassicDark, TerminalThemeLight, TerminalThemeCustom:
	default:
		return errors.New("配色方案无效")
	}
	for _, value := range []string{
		request.Foreground,
		request.Background,
		request.SelectionBackground,
		request.CursorColor,
	} {
		if !terminalHexColorPattern.MatchString(value) {
			return errors.New("颜色格式无效")
		}
	}
	return nil
}

func TerminalProfileToSaveRequest(profile TerminalProfile) SaveTerminalProfileRequest {
	return SaveTerminalProfileRequest{
		ID:                  profile.ID,
		Name:                profile.Name,
		FontFamily:          profile.FontFamily,
		FontSize:            profile.FontSize,
		LineHeight:          profile.LineHeight,
		LetterSpacing:       profile.LetterSpacing,
		CursorStyle:         profile.CursorStyle,
		CursorBlink:         profile.CursorBlink,
		Scrollback:          profile.Scrollback,
		ThemeName:           profile.ThemeName,
		Foreground:          profile.Foreground,
		Background:          profile.Background,
		SelectionBackground: profile.SelectionBackground,
		CursorColor:         profile.CursorColor,
	}
}

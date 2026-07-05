package persistence

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"serverpilot/internal/domain"
)

var (
	ErrTerminalProfileNameExists = errors.New("TERMINAL_PROFILE_NAME_EXISTS: 已存在同名终端配置")
	ErrDefaultTerminalProfile    = errors.New("TERMINAL_PROFILE_DEFAULT: 全局默认终端配置不能删除")
	ErrTerminalProfileInUse      = errors.New("TERMINAL_PROFILE_IN_USE: 该终端配置正在被服务器使用，请确认后删除")
)

func normalizeTerminalProfileID(value *string) any {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func (s *Store) ListTerminalProfiles(ctx context.Context) ([]domain.TerminalProfile, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, font_family, font_size, line_height,
letter_spacing, cursor_style, cursor_blink, scrollback, theme_name,
foreground, background, selection_background, cursor_color, created_at, updated_at
FROM terminal_profiles
ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END, name COLLATE NOCASE, id`, domain.DefaultTerminalProfileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	profiles := make([]domain.TerminalProfile, 0)
	for rows.Next() {
		profile, err := scanTerminalProfile(rows)
		if err != nil {
			return nil, err
		}
		profiles = append(profiles, profile)
	}
	return profiles, rows.Err()
}

func (s *Store) GetTerminalProfile(ctx context.Context, id string) (domain.TerminalProfile, error) {
	return scanTerminalProfile(s.db.QueryRowContext(ctx, `SELECT id, name, font_family, font_size, line_height,
letter_spacing, cursor_style, cursor_blink, scrollback, theme_name,
foreground, background, selection_background, cursor_color, created_at, updated_at
FROM terminal_profiles WHERE id=?`, strings.TrimSpace(id)))
}

func (s *Store) CreateTerminalProfile(
	ctx context.Context,
	request domain.SaveTerminalProfileRequest,
) (domain.TerminalProfile, error) {
	request = domain.NormalizeTerminalProfileRequest(request)
	if err := domain.ValidateTerminalProfile(request); err != nil {
		return domain.TerminalProfile{}, err
	}
	if err := s.ensureTerminalProfileNameAvailable(ctx, request.Name, ""); err != nil {
		return domain.TerminalProfile{}, err
	}
	id, err := generateTerminalProfileID()
	if err != nil {
		return domain.TerminalProfile{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `INSERT INTO terminal_profiles(
id, name, font_family, font_size, line_height, letter_spacing,
cursor_style, cursor_blink, scrollback, theme_name,
foreground, background, selection_background, cursor_color, created_at, updated_at
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, request.Name, request.FontFamily, request.FontSize, request.LineHeight, request.LetterSpacing,
		request.CursorStyle, request.CursorBlink, request.Scrollback, request.ThemeName,
		request.Foreground, request.Background, request.SelectionBackground, request.CursorColor, now, now,
	)
	if err != nil {
		return domain.TerminalProfile{}, terminalProfileSaveError(err)
	}
	return s.GetTerminalProfile(ctx, id)
}

func (s *Store) UpdateTerminalProfile(
	ctx context.Context,
	request domain.SaveTerminalProfileRequest,
) (domain.TerminalProfile, error) {
	request = domain.NormalizeTerminalProfileRequest(request)
	if request.ID == "" {
		return domain.TerminalProfile{}, errors.New("终端配置 ID 不能为空")
	}
	if err := domain.ValidateTerminalProfile(request); err != nil {
		return domain.TerminalProfile{}, err
	}
	if err := s.ensureTerminalProfileNameAvailable(ctx, request.Name, request.ID); err != nil {
		return domain.TerminalProfile{}, err
	}
	result, err := s.db.ExecContext(ctx, `UPDATE terminal_profiles SET
name=?, font_family=?, font_size=?, line_height=?, letter_spacing=?,
cursor_style=?, cursor_blink=?, scrollback=?, theme_name=?,
foreground=?, background=?, selection_background=?, cursor_color=?, updated_at=?
WHERE id=?`,
		request.Name, request.FontFamily, request.FontSize, request.LineHeight, request.LetterSpacing,
		request.CursorStyle, request.CursorBlink, request.Scrollback, request.ThemeName,
		request.Foreground, request.Background, request.SelectionBackground, request.CursorColor,
		time.Now().UTC().Format(time.RFC3339Nano), request.ID,
	)
	if err != nil {
		return domain.TerminalProfile{}, terminalProfileSaveError(err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return domain.TerminalProfile{}, err
	}
	if affected == 0 {
		return domain.TerminalProfile{}, sql.ErrNoRows
	}
	return s.GetTerminalProfile(ctx, request.ID)
}

func (s *Store) DuplicateTerminalProfile(ctx context.Context, id string) (domain.TerminalProfile, error) {
	profile, err := s.GetTerminalProfile(ctx, id)
	if err != nil {
		return domain.TerminalProfile{}, err
	}
	name, err := s.nextTerminalProfileCopyName(ctx, profile.Name)
	if err != nil {
		return domain.TerminalProfile{}, err
	}
	request := domain.TerminalProfileToSaveRequest(profile)
	request.ID = ""
	request.Name = name
	return s.CreateTerminalProfile(ctx, request)
}

func (s *Store) DeleteTerminalProfile(
	ctx context.Context,
	request domain.DeleteTerminalProfileRequest,
) (domain.DeleteTerminalProfileResponse, error) {
	id := strings.TrimSpace(request.ID)
	if id == "" {
		return domain.DeleteTerminalProfileResponse{}, sql.ErrNoRows
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.DeleteTerminalProfileResponse{}, err
	}
	defer tx.Rollback()

	var defaultID string
	if err := tx.QueryRowContext(ctx,
		"SELECT default_terminal_profile_id FROM app_settings WHERE singleton=1",
	).Scan(&defaultID); err != nil {
		return domain.DeleteTerminalProfileResponse{}, err
	}
	if id == domain.DefaultTerminalProfileID || id == strings.TrimSpace(defaultID) {
		return domain.DeleteTerminalProfileResponse{}, ErrDefaultTerminalProfile
	}
	var usages int
	if err := tx.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM connections WHERE terminal_profile_id=?", id,
	).Scan(&usages); err != nil {
		return domain.DeleteTerminalProfileResponse{}, err
	}
	if usages > 0 && !request.ForceDetachServers {
		return domain.DeleteTerminalProfileResponse{}, ErrTerminalProfileInUse
	}
	detached := 0
	if usages > 0 {
		result, err := tx.ExecContext(ctx,
			"UPDATE connections SET terminal_profile_id=NULL, updated_at=? WHERE terminal_profile_id=?",
			time.Now().UTC().Format(time.RFC3339Nano), id,
		)
		if err != nil {
			return domain.DeleteTerminalProfileResponse{}, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return domain.DeleteTerminalProfileResponse{}, err
		}
		detached = int(affected)
	}
	result, err := tx.ExecContext(ctx, "DELETE FROM terminal_profiles WHERE id=?", id)
	if err != nil {
		return domain.DeleteTerminalProfileResponse{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return domain.DeleteTerminalProfileResponse{}, err
	}
	if affected == 0 {
		return domain.DeleteTerminalProfileResponse{}, sql.ErrNoRows
	}
	if err := tx.Commit(); err != nil {
		return domain.DeleteTerminalProfileResponse{}, err
	}
	return domain.DeleteTerminalProfileResponse{ID: id, DetachedServers: detached}, nil
}

func (s *Store) SetDefaultTerminalProfile(ctx context.Context, id string) (domain.AppSettings, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return domain.AppSettings{}, sql.ErrNoRows
	}
	if _, err := s.GetTerminalProfile(ctx, id); err != nil {
		return domain.AppSettings{}, err
	}
	result, err := s.db.ExecContext(ctx, `UPDATE app_settings
SET default_terminal_profile_id=?, settings_version=? WHERE singleton=1`, id, domain.CurrentSettingsVersion)
	if err != nil {
		return domain.AppSettings{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return domain.AppSettings{}, err
	}
	if affected == 0 {
		return domain.AppSettings{}, errors.New("application settings row is missing")
	}
	return s.GetSettings(ctx)
}

func (s *Store) AssignServerTerminalProfile(
	ctx context.Context,
	request domain.AssignServerTerminalProfileRequest,
) (domain.Connection, error) {
	if request.ServerID <= 0 {
		return domain.Connection{}, errors.New("请选择服务器")
	}
	value := normalizeTerminalProfileID(request.TerminalProfileID)
	if id, ok := value.(string); ok {
		if _, err := s.GetTerminalProfile(ctx, id); err != nil {
			return domain.Connection{}, err
		}
	}
	result, err := s.db.ExecContext(ctx,
		"UPDATE connections SET terminal_profile_id=?, updated_at=? WHERE id=?",
		value, time.Now().UTC().Format(time.RFC3339Nano), request.ServerID,
	)
	if err != nil {
		return domain.Connection{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return domain.Connection{}, err
	}
	if affected == 0 {
		return domain.Connection{}, sql.ErrNoRows
	}
	return s.GetConnection(ctx, request.ServerID)
}

func (s *Store) GetResolvedTerminalProfile(
	ctx context.Context,
	request domain.ResolveTerminalProfileRequest,
) (domain.TerminalProfile, error) {
	if request.ServerID > 0 {
		var id sql.NullString
		err := s.db.QueryRowContext(ctx,
			"SELECT terminal_profile_id FROM connections WHERE id=?", request.ServerID,
		).Scan(&id)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return domain.TerminalProfile{}, err
		}
		if id.Valid && strings.TrimSpace(id.String) != "" {
			return s.GetTerminalProfile(ctx, id.String)
		}
	}
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return domain.TerminalProfile{}, err
	}
	defaultID := strings.TrimSpace(settings.DefaultTerminalProfileID)
	if defaultID == "" {
		defaultID = domain.DefaultTerminalProfileID
	}
	return s.GetTerminalProfile(ctx, defaultID)
}

func (s *Store) ensureTerminalProfileNameAvailable(ctx context.Context, name string, excludeID string) error {
	var existingID string
	err := s.db.QueryRowContext(ctx, `
SELECT id FROM terminal_profiles
WHERE lower(name)=lower(?) AND id<>?
ORDER BY id LIMIT 1`, strings.TrimSpace(name), strings.TrimSpace(excludeID)).Scan(&existingID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	return ErrTerminalProfileNameExists
}

func (s *Store) nextTerminalProfileCopyName(ctx context.Context, base string) (string, error) {
	base = strings.TrimSpace(base)
	if base == "" {
		base = "终端配置"
	}
	for index := 1; index < 1000; index++ {
		name := fmt.Sprintf("%s 副本", base)
		if index > 1 {
			name = fmt.Sprintf("%s 副本 %d", base, index)
		}
		err := s.ensureTerminalProfileNameAvailable(ctx, name, "")
		if err == nil {
			return name, nil
		}
		if !errors.Is(err, ErrTerminalProfileNameExists) {
			return "", err
		}
	}
	return "", ErrTerminalProfileNameExists
}

func terminalProfileSaveError(err error) error {
	if err == nil {
		return nil
	}
	if strings.Contains(strings.ToLower(err.Error()), "terminal_profiles") &&
		strings.Contains(strings.ToLower(err.Error()), "unique") {
		return ErrTerminalProfileNameExists
	}
	return err
}

func generateTerminalProfileID() (string, error) {
	var data [12]byte
	if _, err := rand.Read(data[:]); err != nil {
		return "", err
	}
	return "tp-" + hex.EncodeToString(data[:]), nil
}

func scanTerminalProfile(row scanner) (domain.TerminalProfile, error) {
	var profile domain.TerminalProfile
	err := row.Scan(
		&profile.ID,
		&profile.Name,
		&profile.FontFamily,
		&profile.FontSize,
		&profile.LineHeight,
		&profile.LetterSpacing,
		&profile.CursorStyle,
		&profile.CursorBlink,
		&profile.Scrollback,
		&profile.ThemeName,
		&profile.Foreground,
		&profile.Background,
		&profile.SelectionBackground,
		&profile.CursorColor,
		&profile.CreatedAt,
		&profile.UpdatedAt,
	)
	if err != nil {
		return domain.TerminalProfile{}, err
	}
	return profile, nil
}

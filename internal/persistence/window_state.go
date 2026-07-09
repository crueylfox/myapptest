package persistence

import (
	"context"
	"database/sql"
	"time"

	"hostdeck/internal/domain"
)

func (s *Store) GetWindowState(ctx context.Context) (domain.WindowState, bool, error) {
	var state domain.WindowState
	err := s.db.QueryRowContext(ctx, `
SELECT x, y, width, height, monitor_id, is_maximized, updated_at
FROM window_state WHERE singleton=1`,
	).Scan(
		&state.X,
		&state.Y,
		&state.Width,
		&state.Height,
		&state.MonitorID,
		&state.IsMaximized,
		&state.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return domain.WindowState{}, false, nil
		}
		return domain.WindowState{}, false, err
	}
	return state, true, nil
}

func (s *Store) SaveWindowState(ctx context.Context, state domain.WindowState) error {
	if state.UpdatedAt == "" {
		state.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO window_state(singleton, x, y, width, height, monitor_id, is_maximized, updated_at)
VALUES(1, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(singleton) DO UPDATE SET
x=excluded.x,
y=excluded.y,
width=excluded.width,
height=excluded.height,
monitor_id=excluded.monitor_id,
is_maximized=excluded.is_maximized,
updated_at=excluded.updated_at`,
		state.X,
		state.Y,
		state.Width,
		state.Height,
		state.MonitorID,
		state.IsMaximized,
		state.UpdatedAt,
	)
	return err
}

func (s *Store) DeleteWindowState(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM window_state WHERE singleton=1")
	return err
}

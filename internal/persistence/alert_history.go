package persistence

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"hostdeck/internal/domain"
)

const (
	alertStateFiring      = "firing"
	alertStateResolved    = "resolved"
	alertStateInterrupted = "interrupted"
	alertSourceTest       = "test"
)

func (s *Store) BeginAlertSession(ctx context.Context, sessionID string, historyLimit int) error {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return errors.New("alert session id is required")
	}
	limit := normalizeAlertHistoryLimit(historyLimit)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `
UPDATE alert_history
SET state='interrupted', ended_reason='app_restarted', updated_at=?
WHERE state='firing' AND session_id<>?`, now, sessionID); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err = pruneAlertHistoryTx(ctx, tx, limit); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (s *Store) ListAlertHistory(ctx context.Context, limit int) ([]domain.AlertHistoryEvent, error) {
	limit = normalizeAlertHistoryLimit(limit)
	rows, err := s.db.QueryContext(ctx, `
SELECT event_id, server_id, server_name_snapshot, rule_type, severity, state, source,
current_value, threshold_value, unit, title, message, started_at, resolved_at, read_at,
session_id, ended_reason, created_at, updated_at
FROM alert_history
ORDER BY datetime(started_at) DESC, updated_at DESC
LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := make([]domain.AlertHistoryEvent, 0)
	for rows.Next() {
		event, err := scanAlertHistoryEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if events == nil {
		events = []domain.AlertHistoryEvent{}
	}
	return events, rows.Err()
}

func (s *Store) UpsertAlertHistoryEvent(
	ctx context.Context,
	event domain.AlertHistoryEvent,
	historyLimit int,
) (domain.AlertHistoryPersistResult, error) {
	event.EventID = strings.TrimSpace(event.EventID)
	event.Source = strings.TrimSpace(event.Source)
	if event.Source == alertSourceTest {
		return domain.AlertHistoryPersistResult{Skipped: true, ReasonCode: "TEST_ALERT"}, nil
	}
	if event.EventID == "" {
		return domain.AlertHistoryPersistResult{}, errors.New("alert event id is required")
	}
	event.State = normalizeAlertState(event.State)
	if event.State == "" {
		return domain.AlertHistoryPersistResult{}, errors.New("alert state is invalid")
	}
	if event.ServerNameSnapshot == "" {
		event.ServerNameSnapshot = "Unknown"
	}
	if event.StartedAt == "" {
		event.StartedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	readAt := strings.TrimSpace(event.ReadAt)
	if event.Read && readAt == "" {
		readAt = now
	}
	limit := normalizeAlertHistoryLimit(historyLimit)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.AlertHistoryPersistResult{}, err
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO alert_history(
event_id, server_id, server_name_snapshot, rule_type, severity, state, source,
current_value, threshold_value, unit, title, message, started_at, resolved_at, read_at,
session_id, ended_reason, created_at, updated_at
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(event_id) DO UPDATE SET
server_id=excluded.server_id,
server_name_snapshot=excluded.server_name_snapshot,
rule_type=excluded.rule_type,
severity=excluded.severity,
state=excluded.state,
source=excluded.source,
current_value=excluded.current_value,
threshold_value=excluded.threshold_value,
unit=excluded.unit,
title=excluded.title,
message=excluded.message,
started_at=excluded.started_at,
resolved_at=excluded.resolved_at,
read_at=CASE
    WHEN alert_history.read_at<>'' THEN alert_history.read_at
    ELSE excluded.read_at
END,
session_id=excluded.session_id,
ended_reason=excluded.ended_reason,
updated_at=excluded.updated_at`,
		event.EventID,
		event.ServerID,
		event.ServerNameSnapshot,
		event.RuleType,
		event.Severity,
		event.State,
		event.Source,
		floatOrNil(event.CurrentValue),
		floatOrNil(event.ThresholdValue),
		event.Unit,
		event.Title,
		event.Message,
		event.StartedAt,
		event.ResolvedAt,
		readAt,
		event.SessionID,
		event.EndedReason,
		now,
		now,
	)
	if err != nil {
		_ = tx.Rollback()
		return domain.AlertHistoryPersistResult{}, err
	}
	if err = pruneAlertHistoryTx(ctx, tx, limit); err != nil {
		_ = tx.Rollback()
		return domain.AlertHistoryPersistResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return domain.AlertHistoryPersistResult{}, err
	}
	return domain.AlertHistoryPersistResult{Persisted: true}, nil
}

func (s *Store) MarkAlertHistoryRead(ctx context.Context, eventID string) error {
	eventID = strings.TrimSpace(eventID)
	if eventID == "" {
		return errors.New("alert event id is required")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
UPDATE alert_history
SET read_at=CASE WHEN read_at='' THEN ? ELSE read_at END, updated_at=?
WHERE event_id=?`, now, now, eventID)
	return err
}

func (s *Store) MarkAllAlertHistoryRead(ctx context.Context) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
UPDATE alert_history
SET read_at=CASE WHEN read_at='' THEN ? ELSE read_at END, updated_at=?
WHERE read_at=''`, now, now)
	return err
}

func (s *Store) ClearResolvedAlertHistory(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
DELETE FROM alert_history
WHERE state IN ('resolved', 'interrupted')`)
	return err
}

func (s *Store) PruneAlertHistory(ctx context.Context, historyLimit int) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := pruneAlertHistoryTx(ctx, tx, normalizeAlertHistoryLimit(historyLimit)); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func pruneAlertHistoryTx(ctx context.Context, tx *sql.Tx, limit int) error {
	_, err := tx.ExecContext(ctx, `
DELETE FROM alert_history
WHERE state IN ('resolved', 'interrupted')
  AND event_id NOT IN (
    SELECT event_id FROM alert_history
    WHERE state IN ('resolved', 'interrupted')
    ORDER BY datetime(CASE WHEN resolved_at<>'' THEN resolved_at ELSE started_at END) DESC, updated_at DESC
    LIMIT ?
  )`, limit)
	return err
}

func scanAlertHistoryEvent(row scanner) (domain.AlertHistoryEvent, error) {
	var event domain.AlertHistoryEvent
	var current, threshold sql.NullFloat64
	err := row.Scan(
		&event.EventID,
		&event.ServerID,
		&event.ServerNameSnapshot,
		&event.RuleType,
		&event.Severity,
		&event.State,
		&event.Source,
		&current,
		&threshold,
		&event.Unit,
		&event.Title,
		&event.Message,
		&event.StartedAt,
		&event.ResolvedAt,
		&event.ReadAt,
		&event.SessionID,
		&event.EndedReason,
		&event.CreatedAt,
		&event.UpdatedAt,
	)
	if err != nil {
		return domain.AlertHistoryEvent{}, err
	}
	if current.Valid {
		event.CurrentValue = &current.Float64
	}
	if threshold.Valid {
		event.ThresholdValue = &threshold.Float64
	}
	event.Read = event.ReadAt != ""
	return event, nil
}

func normalizeAlertHistoryLimit(limit int) int {
	if limit < domain.MinimumAlertHistoryLimit || limit > domain.MaximumAlertHistoryLimit {
		return domain.DefaultAlertHistoryLimit
	}
	return limit
}

func normalizeAlertState(value string) string {
	switch strings.TrimSpace(value) {
	case alertStateFiring:
		return alertStateFiring
	case alertStateResolved:
		return alertStateResolved
	case alertStateInterrupted:
		return alertStateInterrupted
	default:
		return ""
	}
}

func floatOrNil(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

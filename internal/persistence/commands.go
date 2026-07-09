package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"hostdeck/internal/domain"
)

func (s *Store) ListCommandHistory(
	ctx context.Context,
	request domain.ListCommandHistoryRequest,
) ([]domain.CommandHistoryEntry, error) {
	limit := request.Limit
	if limit <= 0 {
		limit = 200
	}
	query := strings.TrimSpace(request.Query)
	args := []any{}
	sqlText := `SELECT id, server_id, server_name, session_id, command, command_hash, source, executed_at, source_label, target_count, target_server_ids, batch_submission_id
FROM (
    SELECT ch.id, ch.server_id, COALESCE(c.name, '') AS server_name, ch.session_id, ch.command, ch.command_hash, ch.source, ch.executed_at,
        '' AS source_label, 0 AS target_count, '' AS target_server_ids, '' AS batch_submission_id, ch.executed_at AS sort_at
    FROM command_history ch
    LEFT JOIN connections c ON c.id = ch.server_id
    WHERE 1=1`
	if request.Scope != domain.CommandListScopeAll {
		sqlText += ` AND ch.server_id=?`
		args = append(args, request.ServerID)
	}
	if query != "" {
		sqlText += ` AND ch.command LIKE ?`
		args = append(args, "%"+query+"%")
	}
	sqlText += `
    UNION ALL
    SELECT be.id, 0 AS server_id, '' AS server_name, '' AS session_id, be.command, be.command_hash, be.source, be.created_at AS executed_at,
        '批量' AS source_label, COALESCE(targets.target_count, 0) AS target_count, COALESCE(targets.target_server_ids, '') AS target_server_ids,
        be.submission_id AS batch_submission_id, be.created_at AS sort_at
    FROM command_history_batch_entries be
    LEFT JOIN (
        SELECT history_id, COUNT(*) AS target_count, group_concat(server_id, ',') AS target_server_ids
        FROM (
            SELECT history_id, server_id FROM command_history_batch_targets ORDER BY history_id, server_id
        ) ordered_targets
        GROUP BY history_id
    ) targets ON targets.history_id = be.id
    WHERE 1=1`
	if request.Scope != domain.CommandListScopeAll {
		sqlText += ` AND EXISTS (
        SELECT 1 FROM command_history_batch_targets filter_targets
        WHERE filter_targets.history_id = be.id AND filter_targets.server_id = ?
    )`
		args = append(args, request.ServerID)
	}
	if query != "" {
		sqlText += ` AND be.command LIKE ?`
		args = append(args, "%"+query+"%")
	}
	sqlText += `
) logical_history
ORDER BY sort_at DESC
LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := make([]domain.CommandHistoryEntry, 0)
	for rows.Next() {
		entry, err := scanCommandHistoryList(rows)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (s *Store) LatestCommandHistory(ctx context.Context, serverID int64) (domain.CommandHistoryEntry, bool, error) {
	entry, err := scanCommandHistory(s.db.QueryRowContext(ctx, `SELECT ch.id, ch.server_id, COALESCE(c.name, ''), ch.session_id, ch.command, ch.command_hash, ch.source, ch.executed_at
FROM command_history ch
LEFT JOIN connections c ON c.id = ch.server_id
WHERE ch.server_id=? ORDER BY ch.executed_at DESC LIMIT 1`, serverID))
	if err != nil {
		if err == sql.ErrNoRows {
			return domain.CommandHistoryEntry{}, false, nil
		}
		return domain.CommandHistoryEntry{}, false, err
	}
	return entry, true, nil
}

func (s *Store) FindCommandHistoryByHash(ctx context.Context, serverID int64, commandHash string) (domain.CommandHistoryEntry, bool, error) {
	entry, err := scanCommandHistory(s.db.QueryRowContext(ctx, `SELECT ch.id, ch.server_id, COALESCE(c.name, ''), ch.session_id, ch.command, ch.command_hash, ch.source, ch.executed_at
FROM command_history ch
LEFT JOIN connections c ON c.id = ch.server_id
WHERE ch.server_id=? AND ch.command_hash=? ORDER BY ch.executed_at DESC LIMIT 1`, serverID, commandHash))
	if err != nil {
		if err == sql.ErrNoRows {
			return domain.CommandHistoryEntry{}, false, nil
		}
		return domain.CommandHistoryEntry{}, false, err
	}
	return entry, true, nil
}

func (s *Store) InsertCommandHistory(ctx context.Context, entry domain.CommandHistoryEntry) error {
	entry = domain.EnrichCommandHistoryEntry(entry)
	_, err := s.db.ExecContext(ctx, `INSERT INTO command_history(
id, server_id, session_id, command, command_hash, source, executed_at
) VALUES(?, ?, ?, ?, ?, ?, ?)`,
		entry.ID, entry.ServerID, entry.SessionID, entry.Command, entry.CommandHash, entry.Source, entry.ExecutedAt,
	)
	return err
}

func (s *Store) InsertBatchCommandHistory(
	ctx context.Context,
	entry domain.CommandHistoryEntry,
	targetServerIDs []int64,
	submissionID string,
) (domain.CommandHistoryEntry, error) {
	entry = domain.EnrichCommandHistoryEntry(entry)
	if existing, ok, err := s.batchCommandHistoryBySubmissionID(ctx, submissionID); err != nil || ok {
		return existing, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CommandHistoryEntry{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO command_history_batch_entries(
id, command, command_hash, source, submission_id, created_at, updated_at
) VALUES(?, ?, ?, ?, ?, ?, ?)`,
		entry.ID, entry.Command, entry.CommandHash, "batch", submissionID, entry.ExecutedAt, entry.ExecutedAt,
	)
	if err != nil {
		_ = tx.Rollback()
		return domain.CommandHistoryEntry{}, err
	}
	for _, serverID := range targetServerIDs {
		if serverID <= 0 {
			continue
		}
		if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO command_history_batch_targets(history_id, server_id) VALUES(?, ?)`,
			entry.ID, serverID); err != nil {
			_ = tx.Rollback()
			return domain.CommandHistoryEntry{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return domain.CommandHistoryEntry{}, err
	}
	return s.batchCommandHistoryByID(ctx, entry.ID)
}

func (s *Store) UpdateCommandHistoryExecution(
	ctx context.Context,
	id string,
	sessionID string,
	executedAt string,
) (domain.CommandHistoryEntry, error) {
	_, err := s.db.ExecContext(ctx, `UPDATE command_history SET session_id=?, executed_at=? WHERE id=?`,
		sessionID, executedAt, id)
	if err != nil {
		return domain.CommandHistoryEntry{}, err
	}
	return scanCommandHistory(s.db.QueryRowContext(ctx, `SELECT ch.id, ch.server_id, COALESCE(c.name, ''), ch.session_id, ch.command, ch.command_hash, ch.source, ch.executed_at
FROM command_history ch
LEFT JOIN connections c ON c.id = ch.server_id
WHERE ch.id=?`, id))
}

func (s *Store) UpdateCommandHistory(
	ctx context.Context,
	request domain.UpdateCommandHistoryRequest,
	commandHash string,
) (domain.CommandHistoryEntry, error) {
	request.Command = domain.NormalizeHistoryCommand(request.Command)
	result, err := s.db.ExecContext(ctx, `UPDATE command_history SET command=?, command_hash=? WHERE id=?`,
		request.Command, commandHash, request.ID)
	if err != nil {
		return domain.CommandHistoryEntry{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return domain.CommandHistoryEntry{}, err
	}
	if changed > 0 {
		return scanCommandHistory(s.db.QueryRowContext(ctx, `SELECT ch.id, ch.server_id, COALESCE(c.name, ''), ch.session_id, ch.command, ch.command_hash, ch.source, ch.executed_at
FROM command_history ch
LEFT JOIN connections c ON c.id = ch.server_id
WHERE ch.id=?`, request.ID))
	}
	result, err = s.db.ExecContext(ctx, `UPDATE command_history_batch_entries SET command=?, command_hash=?, updated_at=? WHERE id=?`,
		request.Command, commandHash, time.Now().UTC().Format(time.RFC3339Nano), request.ID)
	if err != nil {
		return domain.CommandHistoryEntry{}, err
	}
	changed, err = result.RowsAffected()
	if err != nil {
		return domain.CommandHistoryEntry{}, err
	}
	if changed == 0 {
		return domain.CommandHistoryEntry{}, sql.ErrNoRows
	}
	return s.batchCommandHistoryByID(ctx, request.ID)
}

func (s *Store) DeleteCommandHistory(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM command_history WHERE id=?`, id); err != nil {
		_ = tx.Rollback()
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM command_history_batch_entries WHERE id=?`, id); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (s *Store) ClearCommandHistory(ctx context.Context, serverID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM command_history WHERE server_id=?`, serverID); err != nil {
		_ = tx.Rollback()
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM command_history_batch_targets WHERE server_id=?`, serverID); err != nil {
		_ = tx.Rollback()
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM command_history_batch_entries
WHERE id NOT IN (SELECT DISTINCT history_id FROM command_history_batch_targets)`); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (s *Store) PruneCommandHistory(ctx context.Context, serverID int64, keep int) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM command_history
WHERE server_id=? AND id NOT IN (
    SELECT id FROM command_history WHERE server_id=? ORDER BY executed_at DESC LIMIT ?
)`, serverID, serverID, keep)
	return err
}

func (s *Store) PruneBatchCommandHistory(ctx context.Context, keep int) error {
	if keep <= 0 {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM command_history_batch_entries
WHERE id NOT IN (
    SELECT id FROM command_history_batch_entries ORDER BY created_at DESC LIMIT ?
)`, keep)
	return err
}

func scanCommandHistory(row scanner) (domain.CommandHistoryEntry, error) {
	var entry domain.CommandHistoryEntry
	err := row.Scan(
		&entry.ID,
		&entry.ServerID,
		&entry.ServerName,
		&entry.SessionID,
		&entry.Command,
		&entry.CommandHash,
		&entry.Source,
		&entry.ExecutedAt,
	)
	if err != nil {
		return entry, err
	}
	return domain.EnrichCommandHistoryEntry(entry), nil
}

func scanCommandHistoryList(row scanner) (domain.CommandHistoryEntry, error) {
	var entry domain.CommandHistoryEntry
	var targetServerIDs string
	err := row.Scan(
		&entry.ID,
		&entry.ServerID,
		&entry.ServerName,
		&entry.SessionID,
		&entry.Command,
		&entry.CommandHash,
		&entry.Source,
		&entry.ExecutedAt,
		&entry.SourceLabel,
		&entry.TargetCount,
		&targetServerIDs,
		&entry.BatchSubmissionID,
	)
	if err != nil {
		return domain.CommandHistoryEntry{}, err
	}
	entry.TargetServerIDs = parseTargetServerIDs(targetServerIDs)
	if entry.TargetCount == 0 {
		entry.TargetCount = len(entry.TargetServerIDs)
	}
	if entry.Source == "batch" && entry.SourceLabel == "" {
		entry.SourceLabel = "批量"
	}
	return domain.EnrichCommandHistoryEntry(entry), nil
}

func (s *Store) batchCommandHistoryByID(ctx context.Context, id string) (domain.CommandHistoryEntry, error) {
	return scanCommandHistoryList(s.db.QueryRowContext(ctx, batchCommandHistorySelectSQL+` WHERE be.id=?`, id))
}

func (s *Store) batchCommandHistoryBySubmissionID(
	ctx context.Context,
	submissionID string,
) (domain.CommandHistoryEntry, bool, error) {
	entry, err := scanCommandHistoryList(s.db.QueryRowContext(ctx, batchCommandHistorySelectSQL+` WHERE be.submission_id=?`, submissionID))
	if err != nil {
		if err == sql.ErrNoRows {
			return domain.CommandHistoryEntry{}, false, nil
		}
		return domain.CommandHistoryEntry{}, false, err
	}
	return entry, true, nil
}

const batchCommandHistorySelectSQL = `SELECT be.id, 0 AS server_id, '' AS server_name, '' AS session_id,
be.command, be.command_hash, be.source, be.created_at AS executed_at, '批量' AS source_label,
COALESCE(targets.target_count, 0) AS target_count, COALESCE(targets.target_server_ids, '') AS target_server_ids,
be.submission_id AS batch_submission_id
FROM command_history_batch_entries be
LEFT JOIN (
    SELECT history_id, COUNT(*) AS target_count, group_concat(server_id, ',') AS target_server_ids
    FROM (
        SELECT history_id, server_id FROM command_history_batch_targets ORDER BY history_id, server_id
    ) ordered_targets
    GROUP BY history_id
) targets ON targets.history_id = be.id`

func parseTargetServerIDs(value string) []int64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]int64, 0, len(parts))
	for _, part := range parts {
		parsed, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
		if err != nil || parsed <= 0 {
			continue
		}
		out = append(out, parsed)
	}
	return out
}

func (s *Store) ListCommandFavorites(
	ctx context.Context,
	request domain.ListCommandFavoritesRequest,
) ([]domain.CommandFavorite, error) {
	query := strings.TrimSpace(request.Query)
	args := []any{}
	sqlText := `SELECT f.id, f.title, f.command, f.description, f.scope, f.server_id, COALESCE(c.name, ''), f.group_id, COALESCE(g.name, ''), f.tags, f.sort_order, f.use_count, f.created_at, f.updated_at, f.last_used_at
FROM command_favorites f
LEFT JOIN connections c ON c.id = f.server_id
LEFT JOIN groups g ON g.id = f.group_id
WHERE `
	if request.Scope == domain.CommandListScopeAll {
		sqlText += `1=1`
	} else {
		sqlText += `(f.scope='global'`
		if request.GroupID != nil && *request.GroupID > 0 {
			sqlText += ` OR (f.scope='group' AND f.group_id=?)`
			args = append(args, *request.GroupID)
		}
		if request.ServerID > 0 {
			sqlText += ` OR (f.scope='server' AND f.server_id=?)`
			args = append(args, request.ServerID)
		}
		sqlText += `)`
	}
	if query != "" {
		sqlText += ` AND (f.title LIKE ? OR f.command LIKE ? OR f.tags LIKE ?)`
		like := "%" + query + "%"
		args = append(args, like, like, like)
	}
	sqlText += ` ORDER BY f.scope, f.sort_order ASC, f.updated_at DESC`
	rows, err := s.db.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	favorites := make([]domain.CommandFavorite, 0)
	for rows.Next() {
		favorite, err := scanCommandFavorite(rows)
		if err != nil {
			return nil, err
		}
		favorites = append(favorites, favorite)
	}
	return favorites, rows.Err()
}

func (s *Store) CreateCommandFavorite(
	ctx context.Context,
	favorite domain.CommandFavorite,
) (domain.CommandFavorite, error) {
	tags, err := encodeTags(favorite.Tags)
	if err != nil {
		return domain.CommandFavorite{}, err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO command_favorites(
id, title, command, description, scope, server_id, group_id, tags, sort_order,
use_count, created_at, updated_at, last_used_at
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		favorite.ID, favorite.Title, favorite.Command, favorite.Description, favorite.Scope,
		favorite.ServerID, favorite.GroupID, tags, favorite.SortOrder, favorite.UseCount,
		favorite.CreatedAt, favorite.UpdatedAt, favorite.LastUsedAt,
	)
	if err != nil {
		return domain.CommandFavorite{}, err
	}
	return s.getCommandFavorite(ctx, favorite.ID)
}

func (s *Store) UpdateCommandFavorite(
	ctx context.Context,
	request domain.SaveCommandFavoriteRequest,
) (domain.CommandFavorite, error) {
	tags, err := encodeTags(request.Tags)
	if err != nil {
		return domain.CommandFavorite{}, err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE command_favorites SET
title=?, command=?, description=?, scope=?, server_id=?, group_id=?, tags=?,
sort_order=?, updated_at=? WHERE id=?`,
		request.Title, request.Command, request.Description, request.Scope, request.ServerID,
		request.GroupID, tags, request.SortOrder, time.Now().UTC().Format(time.RFC3339Nano), request.ID,
	)
	if err != nil {
		return domain.CommandFavorite{}, err
	}
	return s.getCommandFavorite(ctx, request.ID)
}

func (s *Store) DeleteCommandFavorite(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM command_favorites WHERE id=?`, id)
	return err
}

func (s *Store) IncrementCommandFavoriteUse(
	ctx context.Context,
	id string,
	usedAt string,
) (domain.CommandFavorite, error) {
	_, err := s.db.ExecContext(ctx, `UPDATE command_favorites
SET use_count=use_count+1, last_used_at=?, updated_at=? WHERE id=?`, usedAt, usedAt, id)
	if err != nil {
		return domain.CommandFavorite{}, err
	}
	return s.getCommandFavorite(ctx, id)
}

func (s *Store) getCommandFavorite(ctx context.Context, id string) (domain.CommandFavorite, error) {
	return scanCommandFavorite(s.db.QueryRowContext(ctx, `SELECT f.id, f.title, f.command, f.description, f.scope, f.server_id, COALESCE(c.name, ''), f.group_id, COALESCE(g.name, ''), f.tags, f.sort_order, f.use_count, f.created_at, f.updated_at, f.last_used_at
FROM command_favorites f
LEFT JOIN connections c ON c.id = f.server_id
LEFT JOIN groups g ON g.id = f.group_id
WHERE f.id=?`, id))
}

func scanCommandFavorite(row scanner) (domain.CommandFavorite, error) {
	var favorite domain.CommandFavorite
	var serverID, groupID sql.NullInt64
	var tags string
	err := row.Scan(
		&favorite.ID,
		&favorite.Title,
		&favorite.Command,
		&favorite.Description,
		&favorite.Scope,
		&serverID,
		&favorite.ServerName,
		&groupID,
		&favorite.GroupName,
		&tags,
		&favorite.SortOrder,
		&favorite.UseCount,
		&favorite.CreatedAt,
		&favorite.UpdatedAt,
		&favorite.LastUsedAt,
	)
	if err != nil {
		return domain.CommandFavorite{}, err
	}
	if serverID.Valid {
		favorite.ServerID = &serverID.Int64
	}
	if groupID.Valid {
		favorite.GroupID = &groupID.Int64
	}
	favorite.Tags = decodeTags(tags)
	return favorite, nil
}

func encodeTags(tags []string) (string, error) {
	if tags == nil {
		tags = []string{}
	}
	value, err := json.Marshal(tags)
	return string(value), err
}

func decodeTags(value string) []string {
	var tags []string
	if err := json.Unmarshal([]byte(value), &tags); err != nil {
		return []string{}
	}
	return tags
}

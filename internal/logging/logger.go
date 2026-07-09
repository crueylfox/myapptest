package logging

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"hostdeck/internal/domain"
)

const maxEntries = 2000

type Logger struct {
	mu      sync.RWMutex
	entries []domain.LogEntry
	file    *os.File
}

func New(directory string) (*Logger, error) {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filepath.Join(directory, "HostDeck.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	return &Logger{file: file}, nil
}

func (l *Logger) Write(level, message, operation string, connectionID int64, err error) {
	entry := domain.LogEntry{
		Time: time.Now().UTC().Format(time.RFC3339Nano), Level: level,
		Message: message, Summary: message, Operation: operation, ConnectionID: connectionID,
	}
	if err != nil {
		entry.Error = err.Error()
		entry.TechnicalMessage = err.Error()
	}
	l.write(entry)
}

func (l *Logger) WriteConnection(
	level string,
	summary string,
	operation string,
	connection domain.Connection,
	connectionErr *domain.ConnectionError,
) {
	entry := domain.LogEntry{
		Time: time.Now().UTC().Format(time.RFC3339Nano), Level: level,
		Message: summary, Summary: summary, ServerName: connection.Name,
		Operation: operation, ConnectionID: connection.ID,
	}
	if connectionErr != nil {
		entry.Error = connectionErr.TechnicalMessage
		entry.TechnicalMessage = connectionErr.TechnicalMessage
		entry.ErrorCode = connectionErr.Code
	}
	l.write(entry)
}

func (l *Logger) write(entry domain.LogEntry) {
	l.mu.Lock()
	if l.file != nil {
		if encodeErr := json.NewEncoder(l.file).Encode(entry); encodeErr != nil && entry.Error == "" {
			entry.Error = "write log file: " + encodeErr.Error()
		}
	}
	l.entries = append(l.entries, entry)
	if len(l.entries) > maxEntries {
		l.entries = append([]domain.LogEntry(nil), l.entries[len(l.entries)-maxEntries:]...)
	}
	l.mu.Unlock()
}

func (l *Logger) List(limit int) []domain.LogEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if limit <= 0 || limit > len(l.entries) {
		limit = len(l.entries)
	}
	start := len(l.entries) - limit
	result := make([]domain.LogEntry, limit)
	copy(result, l.entries[start:])
	return result
}

func (l *Logger) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file == nil {
		return nil
	}
	err := l.file.Close()
	l.file = nil
	return err
}

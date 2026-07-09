package persistence

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"hostdeck/internal/domain"
)

func TestAlertHistoryUpsertReadAndClear(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, "alert.db")
	defer store.Close()

	event := alertHistoryEvent("alert-a", 42, "firing", "session-a", "2026-06-23T10:00:00Z")
	result, err := store.UpsertAlertHistoryEvent(ctx, event, 500)
	if err != nil || !result.Persisted || result.Skipped {
		t.Fatalf("persist result=%+v err=%v", result, err)
	}

	events, err := store.ListAlertHistory(ctx, 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].EventID != "alert-a" || events[0].State != "firing" || events[0].Read {
		t.Fatalf("events after insert=%+v", events)
	}

	resolved := event
	resolved.State = "resolved"
	resolved.ResolvedAt = "2026-06-23T10:05:00Z"
	if _, err := store.UpsertAlertHistoryEvent(ctx, resolved, 500); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkAlertHistoryRead(ctx, "alert-a"); err != nil {
		t.Fatal(err)
	}
	events, err = store.ListAlertHistory(ctx, 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].State != "resolved" || !events[0].Read || events[0].ResolvedAt == "" {
		t.Fatalf("events after resolve/read=%+v", events)
	}

	firing := alertHistoryEvent("alert-b", 43, "firing", "session-a", "2026-06-23T10:10:00Z")
	if _, err := store.UpsertAlertHistoryEvent(ctx, firing, 500); err != nil {
		t.Fatal(err)
	}
	if err := store.ClearResolvedAlertHistory(ctx); err != nil {
		t.Fatal(err)
	}
	events, err = store.ListAlertHistory(ctx, 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].EventID != "alert-b" || events[0].State != "firing" {
		t.Fatalf("clear resolved should keep firing: %+v", events)
	}
}

func TestAlertHistorySessionInterruptedTestSkipAndPrune(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, "alert-prune.db")
	defer store.Close()

	firing := alertHistoryEvent("old-firing", 1, "firing", "old-session", "2026-06-23T10:59:30Z")
	if _, err := store.UpsertAlertHistoryEvent(ctx, firing, 50); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 55; index++ {
		event := alertHistoryEvent(
			"resolved-"+string(rune('a'+index)),
			int64(index+10),
			"resolved",
			"old-session",
			"2026-06-23T09:00:00Z",
		)
		event.ResolvedAt = "2026-06-23T10:" + twoDigit(index%60) + ":00Z"
		if _, err := store.UpsertAlertHistoryEvent(ctx, event, 50); err != nil {
			t.Fatal(err)
		}
	}
	testEvent := alertHistoryEvent("test-alert", 999, "firing", "old-session", "2026-06-23T10:59:00Z")
	testEvent.Source = "test"
	result, err := store.UpsertAlertHistoryEvent(ctx, testEvent, 50)
	if err != nil || !result.Skipped || result.ReasonCode != "TEST_ALERT" {
		t.Fatalf("test alert result=%+v err=%v", result, err)
	}

	if err := store.BeginAlertSession(ctx, "new-session", 50); err != nil {
		t.Fatal(err)
	}
	events, err := store.ListAlertHistory(ctx, 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 50 {
		t.Fatalf("history length=%d want 50 events=%+v", len(events), events)
	}
	var sawInterrupted, sawTest bool
	for _, event := range events {
		if event.EventID == "old-firing" {
			sawInterrupted = event.State == "interrupted" && event.EndedReason == "app_restarted"
		}
		if event.EventID == "test-alert" {
			sawTest = true
		}
		if event.State == "firing" {
			t.Fatalf("old firing should not remain active: %+v", event)
		}
	}
	if !sawInterrupted {
		t.Fatalf("old firing was not interrupted: %+v", events)
	}
	if sawTest {
		t.Fatalf("test alert was persisted: %+v", events)
	}
}

func TestAlertHistoryMarkAllReadAndDeletedServerHistory(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, "alert-read.db")
	defer store.Close()

	event := alertHistoryEvent("deleted-server-alert", 987654, "resolved", "session-a", "2026-06-23T10:00:00Z")
	event.ResolvedAt = "2026-06-23T10:01:00Z"
	if _, err := store.UpsertAlertHistoryEvent(ctx, event, 500); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkAllAlertHistoryRead(ctx); err != nil {
		t.Fatal(err)
	}
	events, err := store.ListAlertHistory(ctx, 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].ServerID != 987654 || events[0].ServerNameSnapshot != "server-987654" || !events[0].Read {
		t.Fatalf("deleted server history not retained/read: %+v", events)
	}
}

func TestWindowStatePersistenceAndBackupExclusion(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, "window.db")
	defer store.Close()

	state := domain.WindowState{X: 120, Y: 80, Width: 1180, Height: 820, MonitorID: "monitor-a", IsMaximized: true}
	if err := store.SaveWindowState(ctx, state); err != nil {
		t.Fatal(err)
	}
	actual, ok, err := store.GetWindowState(ctx)
	if err != nil || !ok {
		t.Fatalf("window state ok=%v err=%v", ok, err)
	}
	if actual.Width != 1180 || actual.Height != 820 || actual.MonitorID != "monitor-a" || !actual.IsMaximized {
		t.Fatalf("window state=%+v", actual)
	}

	event := alertHistoryEvent("alert-not-in-backup", 7, "resolved", "session-a", "2026-06-23T11:00:00Z")
	event.ResolvedAt = "2026-06-23T11:01:00Z"
	if _, err := store.UpsertAlertHistoryEvent(ctx, event, 500); err != nil {
		t.Fatal(err)
	}
	payload, err := store.ExportBackupPayload(ctx)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	text := string(encoded)
	if strings.Contains(text, "alert-not-in-backup") || strings.Contains(text, "server-7") || strings.Contains(text, "monitor-a") {
		t.Fatalf("runtime alert/window state leaked into backup payload: %s", text)
	}
	if payload.Settings == nil ||
		payload.Settings.WindowWidth != domain.DefaultWindowWidth ||
		payload.Settings.WindowHeight != domain.DefaultWindowHeight ||
		payload.Settings.WindowMaximized {
		t.Fatalf("backup settings kept runtime window state: %+v", payload.Settings)
	}
	if err := store.DeleteWindowState(ctx); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := store.GetWindowState(ctx); err != nil || ok {
		t.Fatalf("window state after delete ok=%v err=%v", ok, err)
	}
}

func openTestStore(t *testing.T, name string) *Store {
	t.Helper()
	store, err := Open(context.Background(), filepath.Join(t.TempDir(), name))
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func alertHistoryEvent(eventID string, serverID int64, state string, sessionID string, startedAt string) domain.AlertHistoryEvent {
	current := 91.5
	threshold := 90.0
	return domain.AlertHistoryEvent{
		EventID:            eventID,
		ServerID:           serverID,
		ServerNameSnapshot: "server-" + formatInt(serverID),
		RuleType:           "cpu_high",
		Severity:           "warning",
		State:              state,
		Source:             "monitor",
		CurrentValue:       &current,
		ThresholdValue:     &threshold,
		Unit:               "%",
		Title:              "CPU 使用率过高",
		Message:            "CPU 使用率持续高于阈值",
		StartedAt:          startedAt,
		SessionID:          sessionID,
	}
}

func formatInt(value int64) string {
	return fmt.Sprintf("%d", value)
}

func twoDigit(value int) string {
	if value < 10 {
		return "0" + formatInt(int64(value))
	}
	return formatInt(int64(value))
}

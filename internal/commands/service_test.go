package commands

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"serverpilot/internal/domain"
	"serverpilot/internal/persistence"
)

func TestCommandHistoryLifecycleAndFiltering(t *testing.T) {
	ctx := context.Background()
	store := newCommandStore(t)
	service := New(store)
	server := seedCommandServer(t, ctx, store, "prod", nil)

	first, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID: server.ID, SessionID: "s1", Command: "  uptime  ", Source: "terminal",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !first.Recorded || first.Entry == nil || first.Entry.Command != "uptime" {
		t.Fatalf("record result=%+v", first)
	}
	duplicate, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID: server.ID, SessionID: "s2", Command: "uptime",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !duplicate.Recorded || duplicate.Entry == nil || duplicate.Entry.ID != first.Entry.ID || duplicate.Entry.SessionID != "s2" {
		t.Fatalf("duplicate result=%+v first=%+v", duplicate, first)
	}
	skipped, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID: server.ID, SessionID: "s2", Command: "curl -H 'Authorization: Bearer secret' https://example.invalid",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !skipped.Skipped || skipped.Recorded || skipped.ReasonCode != "SENSITIVE" {
		t.Fatalf("sensitive command was not skipped: %+v", skipped)
	}
	if _, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID: server.ID, SessionID: "s2", Command: "df -h",
	}); err != nil {
		t.Fatal(err)
	}
	entries, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{ServerID: server.ID, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].Command != "df -h" || entries[1].Command != "uptime" {
		t.Fatalf("entries=%+v", entries)
	}
	repeatedOlder, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID: server.ID, SessionID: "s3", Command: "uptime",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !repeatedOlder.Recorded || repeatedOlder.Entry == nil || repeatedOlder.Entry.ID != first.Entry.ID || repeatedOlder.Entry.SessionID != "s3" {
		t.Fatalf("older duplicate result=%+v first=%+v", repeatedOlder, first)
	}
	entries, err = service.ListHistory(ctx, domain.ListCommandHistoryRequest{ServerID: server.ID, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].Command != "uptime" || entries[1].Command != "df -h" {
		t.Fatalf("older duplicate was not moved to the top without duplicating: %+v", entries)
	}
	found, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{ServerID: server.ID, Query: "up", Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 1 || found[0].Command != "uptime" {
		t.Fatalf("search=%+v", found)
	}
	if err := service.DeleteHistory(ctx, entries[0].ID); err != nil {
		t.Fatal(err)
	}
	entries, err = service.ListHistory(ctx, domain.ListCommandHistoryRequest{ServerID: server.ID, Limit: 20})
	if err != nil || len(entries) != 1 {
		t.Fatalf("after delete entries=%+v err=%v", entries, err)
	}
	if err := service.ClearHistory(ctx, server.ID); err != nil {
		t.Fatal(err)
	}
	entries, err = service.ListHistory(ctx, domain.ListCommandHistoryRequest{ServerID: server.ID, Limit: 20})
	if err != nil || len(entries) != 0 {
		t.Fatalf("after clear entries=%+v err=%v", entries, err)
	}
}

func TestCommandHistoryAllAndCurrentServerScopes(t *testing.T) {
	ctx := context.Background()
	store := newCommandStore(t)
	service := New(store)
	first := seedCommandServer(t, ctx, store, "prod-a", nil)
	second := seedCommandServer(t, ctx, store, "prod-b", nil)
	if _, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID: first.ID, SessionID: "s1", Command: "uptime", Source: "terminal",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID: second.ID, SessionID: "s2", Command: "df -h", Source: "terminal",
	}); err != nil {
		t.Fatal(err)
	}

	all, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{
		Scope: domain.CommandListScopeAll,
		Limit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("all history=%+v", all)
	}
	names := map[int64]string{}
	for _, entry := range all {
		names[entry.ServerID] = entry.ServerName
	}
	if names[first.ID] != "prod-a" || names[second.ID] != "prod-b" {
		t.Fatalf("server names not joined for all history: %+v", all)
	}

	current, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{
		ServerID: first.ID,
		Scope:    domain.CommandListScopeCurrentServer,
		Limit:    10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(current) != 1 || current[0].ServerID != first.ID || current[0].Command != "uptime" {
		t.Fatalf("current history=%+v", current)
	}
}

func TestMultilineCommandHistoryRecordsSingleEntryAndPreview(t *testing.T) {
	ctx := context.Background()
	store := newCommandStore(t)
	service := New(store)
	server := seedCommandServer(t, ctx, store, "prod-multiline", nil)

	multiline, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID:  server.ID,
		SessionID: "s1",
		Command:   "  docker ps\r\ndocker images\r\n  docker volume ls  ",
		Source:    "terminal",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !multiline.Recorded || multiline.Entry == nil {
		t.Fatalf("multiline record result=%+v", multiline)
	}
	if multiline.Entry.Command != "docker ps\ndocker images\n  docker volume ls" {
		t.Fatalf("multiline command was not normalized: %q", multiline.Entry.Command)
	}
	if !multiline.Entry.IsMultiline || multiline.Entry.Preview != "docker ps ..." {
		t.Fatalf("multiline metadata=%+v", multiline.Entry)
	}

	continuedCommand := strings.Join([]string{`echo \`, `1 \`, `2 \`, "你好"}, "\n")
	if normalized := domain.NormalizeHistoryCommand(strings.ReplaceAll(continuedCommand, "\n", "\r\n") + "\r\n"); normalized != continuedCommand {
		t.Fatalf("continued command normalization=%q", normalized)
	}
	if !domain.IsMultilineHistoryCommand(continuedCommand) || domain.BuildCommandPreview(continuedCommand) != `echo \ ...` {
		t.Fatalf("continued command metadata preview=%q multiline=%v", domain.BuildCommandPreview(continuedCommand), domain.IsMultilineHistoryCommand(continuedCommand))
	}
	continued, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID:  server.ID,
		SessionID: "s1",
		Command:   strings.ReplaceAll(continuedCommand, "\n", "\r\n") + "\r\n",
		Source:    "terminal",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !continued.Recorded || continued.Entry == nil || continued.Entry.Command != continuedCommand ||
		!continued.Entry.IsMultiline || continued.Entry.Preview != `echo \ ...` {
		t.Fatalf("continued multiline history=%+v", continued)
	}

	found, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{
		ServerID: server.ID,
		Query:    "volume",
		Limit:    10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 1 || found[0].ID != multiline.Entry.ID || !found[0].IsMultiline {
		t.Fatalf("second-line search did not return the single multiline entry: %+v", found)
	}
	foundChinese, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{
		ServerID: server.ID,
		Query:    "你好",
		Limit:    10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(foundChinese) != 1 || foundChinese[0].ID != continued.Entry.ID {
		t.Fatalf("continued command Chinese search did not return the entry: %+v", foundChinese)
	}

	single, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID:  server.ID,
		SessionID: "s1",
		Command:   "pwd\r\n",
		Source:    "terminal",
	})
	if err != nil {
		t.Fatal(err)
	}
	if single.Entry == nil || single.Entry.IsMultiline || single.Entry.Preview != "pwd" || single.Entry.Command != "pwd" {
		t.Fatalf("single trailing newline was misclassified: %+v", single.Entry)
	}

	updated, err := service.UpdateHistory(ctx, domain.UpdateCommandHistoryRequest{
		ID:      single.Entry.ID,
		Command: "printf ok\r\nprintf done",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Entry.Command != "printf ok\nprintf done" || !updated.Entry.IsMultiline || updated.Entry.Preview != "printf ok ..." {
		t.Fatalf("updated multiline history=%+v", updated.Entry)
	}

	sensitive, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID:  server.ID,
		SessionID: "s1",
		Command:   "echo start\nexport TOKEN=secret-value",
		Source:    "terminal",
	})
	if err != nil {
		t.Fatal(err)
	}
	if sensitive.Recorded || !sensitive.Skipped || sensitive.ReasonCode != "SENSITIVE" {
		t.Fatalf("sensitive second line was not filtered: %+v", sensitive)
	}
	splitSensitive, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID:  server.ID,
		SessionID: "s1",
		Command:   "curl https://example.invalid\n-u user:password",
		Source:    "terminal",
	})
	if err != nil {
		t.Fatal(err)
	}
	if splitSensitive.Recorded || !splitSensitive.Skipped || splitSensitive.ReasonCode != "SENSITIVE" {
		t.Fatalf("sensitive command split across lines was not filtered: %+v", splitSensitive)
	}
	tooLong, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID:  server.ID,
		SessionID: "s1",
		Command:   strings.Repeat("a", maxCommandLength) + "\nb",
		Source:    "terminal",
	})
	if err != nil {
		t.Fatal(err)
	}
	if tooLong.Recorded || !tooLong.Skipped || tooLong.ReasonCode != "TOO_LONG" {
		t.Fatalf("too-long multiline command was not filtered: %+v", tooLong)
	}
}

func TestBatchCommandHistorySingleEntryTargetsAndIdempotency(t *testing.T) {
	ctx := context.Background()
	store := newCommandStore(t)
	service := New(store)
	first := seedCommandServer(t, ctx, store, "batch-a", nil)
	second := seedCommandServer(t, ctx, store, "batch-b", nil)
	third := seedCommandServer(t, ctx, store, "batch-c", nil)
	other := seedCommandServer(t, ctx, store, "batch-d", nil)

	recorded, err := service.RecordBatchHistory(ctx, domain.RecordBatchCommandHistoryRequest{
		Command: "uname -a", SuccessfulServerIDs: []int64{first.ID, second.ID, third.ID, second.ID}, SubmissionID: "submit-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !recorded.Recorded || recorded.Entry == nil || recorded.Entry.Source != "batch" || recorded.TargetCount != 3 {
		t.Fatalf("batch history result=%+v", recorded)
	}
	if recorded.Entry.ServerID != 0 || recorded.Entry.TargetCount != 3 ||
		len(recorded.Entry.TargetServerIDs) != 3 || recorded.Entry.SourceLabel != "批量" {
		t.Fatalf("batch history entry=%+v", recorded.Entry)
	}
	all, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{
		Scope: domain.CommandListScopeAll,
		Query: "uname",
		Limit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].ID != recorded.HistoryID || all[0].TargetCount != 3 {
		t.Fatalf("all batch history=%+v result=%+v", all, recorded)
	}
	for _, server := range []domain.Connection{first, second, third} {
		current, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{
			ServerID: server.ID,
			Scope:    domain.CommandListScopeCurrentServer,
			Query:    "uname",
			Limit:    10,
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(current) != 1 || current[0].ID != recorded.HistoryID || current[0].TargetCount != 3 {
			t.Fatalf("current batch history server=%d entries=%+v", server.ID, current)
		}
	}
	notTarget, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{
		ServerID: other.ID,
		Scope:    domain.CommandListScopeCurrentServer,
		Query:    "uname",
		Limit:    10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(notTarget) != 0 {
		t.Fatalf("non-target server saw batch history: %+v", notTarget)
	}

	multiline, err := service.RecordBatchHistory(ctx, domain.RecordBatchCommandHistoryRequest{
		Command:             "docker ps\r\ndocker images",
		SuccessfulServerIDs: []int64{first.ID, second.ID},
		SubmissionID:        "submit-multiline",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !multiline.Recorded || multiline.Entry == nil || multiline.Entry.Command != "docker ps\ndocker images" ||
		!multiline.Entry.IsMultiline || multiline.Entry.Preview != "docker ps ..." || multiline.TargetCount != 2 {
		t.Fatalf("multiline batch history=%+v", multiline)
	}
	multilineAll, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{
		Scope: domain.CommandListScopeAll,
		Query: "images",
		Limit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(multilineAll) != 1 || multilineAll[0].ID != multiline.HistoryID || multilineAll[0].TargetCount != 2 {
		t.Fatalf("multiline batch should be one logical entry: %+v", multilineAll)
	}

	partial, err := service.RecordBatchHistory(ctx, domain.RecordBatchCommandHistoryRequest{
		Command: "date", SuccessfulServerIDs: []int64{first.ID, second.ID}, SubmissionID: "submit-2",
	})
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := service.RecordBatchHistory(ctx, domain.RecordBatchCommandHistoryRequest{
		Command: "date", SuccessfulServerIDs: []int64{first.ID, second.ID, third.ID}, SubmissionID: "submit-2",
	})
	if err != nil {
		t.Fatal(err)
	}
	if repeated.HistoryID != partial.HistoryID || repeated.TargetCount != 2 {
		t.Fatalf("same submission was not idempotent: first=%+v repeated=%+v", partial, repeated)
	}
	again, err := service.RecordBatchHistory(ctx, domain.RecordBatchCommandHistoryRequest{
		Command: "date", SuccessfulServerIDs: []int64{first.ID, second.ID}, SubmissionID: "submit-3",
	})
	if err != nil {
		t.Fatal(err)
	}
	if again.HistoryID == partial.HistoryID {
		t.Fatalf("different submission reused history: first=%+v again=%+v", partial, again)
	}
	dateEntries, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{
		Scope: domain.CommandListScopeAll,
		Query: "date",
		Limit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(dateEntries) != 2 {
		t.Fatalf("same command should create one row per distinct submission, got %+v", dateEntries)
	}
	thirdDate, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{
		ServerID: third.ID,
		Scope:    domain.CommandListScopeCurrentServer,
		Query:    "date",
		Limit:    10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(thirdDate) != 0 {
		t.Fatalf("partial failure target leaked to third server: %+v", thirdDate)
	}
}

func TestBatchCommandHistoryUsesExistingSafetyRules(t *testing.T) {
	ctx := context.Background()
	store := newCommandStore(t)
	service := New(store)
	server := seedCommandServer(t, ctx, store, "batch-prod", nil)

	emptyTargets, err := service.RecordBatchHistory(ctx, domain.RecordBatchCommandHistoryRequest{
		Command: "uname -a", SuccessfulServerIDs: nil, SubmissionID: "empty-targets",
	})
	if err != nil {
		t.Fatal(err)
	}
	if emptyTargets.Recorded || !emptyTargets.Skipped || emptyTargets.ReasonCode != "NO_TARGETS" {
		t.Fatalf("empty target result=%+v", emptyTargets)
	}

	for _, item := range []struct {
		name    string
		command string
		reason  string
	}{
		{name: "too-long", command: strings.Repeat("a", maxCommandLength+1), reason: "TOO_LONG"},
		{name: "control", command: "printf \x1b[31mred", reason: "CONTROL_SEQUENCE"},
		{name: "sensitive", command: "echo ok\ntoken=secret", reason: "SENSITIVE"},
	} {
		t.Run(item.name, func(t *testing.T) {
			result, err := service.RecordBatchHistory(ctx, domain.RecordBatchCommandHistoryRequest{
				Command: item.command, SuccessfulServerIDs: []int64{server.ID}, SubmissionID: "skip-" + item.name,
			})
			if err != nil {
				t.Fatal(err)
			}
			if result.Recorded || !result.Skipped || result.ReasonCode != item.reason {
				t.Fatalf("expected skipped %s, got %+v", item.reason, result)
			}
		})
	}
}

func TestBatchCommandHistoryUpdateDeleteAndRetention(t *testing.T) {
	ctx := context.Background()
	store := newCommandStore(t)
	retention := 500
	service := NewWithHistoryLimit(store, func() int { return retention })
	first := seedCommandServer(t, ctx, store, "batch-retention-a", nil)
	second := seedCommandServer(t, ctx, store, "batch-retention-b", nil)

	recorded, err := service.RecordBatchHistory(ctx, domain.RecordBatchCommandHistoryRequest{
		Command: "hostname", SuccessfulServerIDs: []int64{first.ID, second.ID}, SubmissionID: "edit-delete",
	})
	if err != nil {
		t.Fatal(err)
	}
	updated, err := service.UpdateHistory(ctx, domain.UpdateCommandHistoryRequest{
		ID:      recorded.HistoryID,
		Command: "hostname -f",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Entry.ID != recorded.HistoryID || updated.Entry.Command != "hostname -f" || updated.Entry.TargetCount != 2 {
		t.Fatalf("updated batch history=%+v", updated)
	}
	secondView, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{
		ServerID: second.ID,
		Scope:    domain.CommandListScopeCurrentServer,
		Query:    "hostname",
		Limit:    10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(secondView) != 1 || secondView[0].ID != recorded.HistoryID || secondView[0].Command != "hostname -f" {
		t.Fatalf("updated batch not visible through target relation: %+v", secondView)
	}
	if err := service.DeleteHistory(ctx, recorded.HistoryID); err != nil {
		t.Fatal(err)
	}
	afterDelete, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{
		Scope: domain.CommandListScopeAll,
		Query: "hostname",
		Limit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(afterDelete) != 0 {
		t.Fatalf("deleted batch history remained: %+v", afterDelete)
	}

	for index := 0; index < retention+5; index++ {
		if _, err := service.RecordBatchHistory(ctx, domain.RecordBatchCommandHistoryRequest{
			Command:             "echo batch-retention-" + string(rune('a'+index%26)) + "-" + string(rune('0'+index%10)) + "-" + string(rune('A'+index%26)),
			SuccessfulServerIDs: []int64{first.ID, second.ID},
			SubmissionID:        "retention-" + string(rune('0'+index/100)) + "-" + string(rune('0'+(index/10)%10)) + "-" + string(rune('0'+index%10)),
		}); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{
		Scope: domain.CommandListScopeAll,
		Query: "batch-retention",
		Limit: retention + 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != retention {
		t.Fatalf("batch retention should count main records only, len=%d", len(entries))
	}
	for _, entry := range entries {
		if entry.TargetCount != 2 {
			t.Fatalf("target relation affected retention entry=%+v", entry)
		}
	}
}

func TestCommandHistoryRetentionLimit(t *testing.T) {
	ctx := context.Background()
	store := newCommandStore(t)
	retention := 500
	service := NewWithHistoryLimit(store, func() int { return retention })
	server := seedCommandServer(t, ctx, store, "prod", nil)
	for index := 0; index < retention+5; index++ {
		if _, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
			ServerID: server.ID, SessionID: "s1", Command: fmt.Sprintf("echo retention-test-%03d", index),
		}); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{ServerID: server.ID, Limit: retention + 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != retention {
		t.Fatalf("retention len=%d", len(entries))
	}
}

func TestCommandHistoryDefaultAndConfiguredListLimits(t *testing.T) {
	ctx := context.Background()
	store := newCommandStore(t)
	service := NewWithHistoryLimit(store, func() int { return 1200 })
	server := seedCommandServer(t, ctx, store, "prod", nil)

	entries, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{ServerID: server.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("empty history=%+v", entries)
	}

	for index := 0; index < 3; index++ {
		if _, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
			ServerID: server.ID, SessionID: "s1", Command: "echo limit-test-" + string(rune('0'+index)),
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{
		ServerID: server.ID,
		Limit:    domain.MaximumCommandHistoryMaxEntries + 1,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestCommandFavoritesCRUDAndScope(t *testing.T) {
	ctx := context.Background()
	store := newCommandStore(t)
	service := New(store)
	group, err := store.SaveGroup(ctx, domain.Group{Name: "prod"})
	if err != nil {
		t.Fatal(err)
	}
	server := seedCommandServer(t, ctx, store, "prod-a", &group.ID)
	other := seedCommandServer(t, ctx, store, "other", nil)
	global := createFavorite(t, ctx, service, domain.SaveCommandFavoriteRequest{
		Title: "List", Command: "ls -la", Scope: domain.CommandScopeGlobal, Tags: []string{"fs", "fs"},
	})
	groupFavorite := createFavorite(t, ctx, service, domain.SaveCommandFavoriteRequest{
		Title: "Journal", Command: "journalctl -xe", Scope: domain.CommandScopeGroup, GroupID: &group.ID,
	})
	serverFavorite := createFavorite(t, ctx, service, domain.SaveCommandFavoriteRequest{
		Title: "Disk", Command: "df -h", Scope: domain.CommandScopeServer, ServerID: &server.ID,
	})
	visible, err := service.ListFavorites(ctx, domain.ListCommandFavoritesRequest{ServerID: server.ID, GroupID: &group.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(visible) != 3 {
		t.Fatalf("visible favorites=%+v", visible)
	}
	allFavorites, err := service.ListFavorites(ctx, domain.ListCommandFavoritesRequest{Scope: domain.CommandListScopeAll})
	if err != nil {
		t.Fatal(err)
	}
	if len(allFavorites) != 3 {
		t.Fatalf("all favorites=%+v", allFavorites)
	}
	foundServerName := false
	foundGroupName := false
	for _, favorite := range allFavorites {
		if favorite.ID == serverFavorite.ID && favorite.ServerName == "prod-a" {
			foundServerName = true
		}
		if favorite.ID == groupFavorite.ID && favorite.GroupName == "prod" {
			foundGroupName = true
		}
	}
	if !foundServerName || !foundGroupName {
		t.Fatalf("favorite source names not joined: %+v", allFavorites)
	}
	otherVisible, err := service.ListFavorites(ctx, domain.ListCommandFavoritesRequest{ServerID: other.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(otherVisible) != 1 || otherVisible[0].ID != global.ID {
		t.Fatalf("other visible=%+v", otherVisible)
	}
	if len(global.Tags) != 1 || global.Tags[0] != "fs" {
		t.Fatalf("tags were not normalized: %+v", global.Tags)
	}
	updated, err := service.UpdateFavorite(ctx, domain.SaveCommandFavoriteRequest{
		ID: serverFavorite.ID, Title: "Disk usage", Command: "df -h /", Scope: domain.CommandScopeServer, ServerID: &server.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Title != "Disk usage" || updated.Command != "df -h /" {
		t.Fatalf("updated=%+v", updated)
	}
	used, err := service.IncrementFavoriteUse(ctx, groupFavorite.ID)
	if err != nil {
		t.Fatal(err)
	}
	if used.UseCount != 1 || used.LastUsedAt == "" {
		t.Fatalf("used=%+v", used)
	}
	if err := service.DeleteFavorite(ctx, updated.ID); err != nil {
		t.Fatal(err)
	}
	visible, err = service.ListFavorites(ctx, domain.ListCommandFavoritesRequest{ServerID: server.ID, GroupID: &group.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(visible) != 2 {
		t.Fatalf("after delete=%+v", visible)
	}
}

func TestCommandListsReturnEmptySlicesAndFavoriteDefaults(t *testing.T) {
	ctx := context.Background()
	store := newCommandStore(t)
	service := New(store)
	server := seedCommandServer(t, ctx, store, "empty", nil)

	history, err := service.ListHistory(ctx, domain.ListCommandHistoryRequest{ServerID: server.ID})
	if err != nil {
		t.Fatal(err)
	}
	if history == nil || len(history) != 0 {
		t.Fatalf("history should be a non-nil empty slice: %#v", history)
	}

	favorites, err := service.ListFavorites(ctx, domain.ListCommandFavoritesRequest{ServerID: server.ID})
	if err != nil {
		t.Fatal(err)
	}
	if favorites == nil || len(favorites) != 0 {
		t.Fatalf("favorites should be a non-nil empty slice: %#v", favorites)
	}

	favorite, err := service.CreateFavorite(ctx, domain.SaveCommandFavoriteRequest{
		Title: "Pwd", Command: "pwd", Scope: domain.CommandScopeGlobal,
	})
	if err != nil {
		t.Fatal(err)
	}
	if favorite.Tags == nil || len(favorite.Tags) != 0 {
		t.Fatalf("nil tags should normalize to empty slice: %#v", favorite.Tags)
	}
	if favorite.SortOrder != 0 {
		t.Fatalf("default sort order should remain 0: %#v", favorite)
	}
}

func TestCommandFavoriteScopeValidation(t *testing.T) {
	ctx := context.Background()
	store := newCommandStore(t)
	service := New(store)

	if _, err := service.CreateFavorite(ctx, domain.SaveCommandFavoriteRequest{
		Title: "Server", Command: "pwd", Scope: domain.CommandScopeServer,
	}); err == nil {
		t.Fatal("expected server-scoped favorite without server ID to fail")
	}
	if _, err := service.CreateFavorite(ctx, domain.SaveCommandFavoriteRequest{
		Title: "Group", Command: "pwd", Scope: domain.CommandScopeGroup,
	}); err == nil {
		t.Fatal("expected group-scoped favorite without group ID to fail")
	}
	if _, err := service.CreateFavorite(ctx, domain.SaveCommandFavoriteRequest{
		Title: "Global", Command: "pwd", Scope: domain.CommandScopeGlobal,
	}); err != nil {
		t.Fatalf("global favorite should not require server or group ID: %v", err)
	}
}

func TestFavoriteSensitiveConfirmation(t *testing.T) {
	ctx := context.Background()
	store := newCommandStore(t)
	service := New(store)
	_, err := service.CreateFavorite(ctx, domain.SaveCommandFavoriteRequest{
		Title: "login", Command: "mysql -uroot -psecret", Scope: domain.CommandScopeGlobal,
	})
	if err == nil {
		t.Fatal("expected sensitive confirmation error")
	}
	favorite, err := service.CreateFavorite(ctx, domain.SaveCommandFavoriteRequest{
		Title: "login", Command: "mysql -uroot -psecret", Scope: domain.CommandScopeGlobal, AllowSensitive: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if favorite.ID == "" {
		t.Fatalf("favorite=%+v", favorite)
	}
}

func TestCommandSuggestionsSourcesSortingAndDedupe(t *testing.T) {
	ctx := context.Background()
	store := newCommandStore(t)
	service := New(store)
	group, err := store.SaveGroup(ctx, domain.Group{Name: "prod"})
	if err != nil {
		t.Fatal(err)
	}
	server := seedCommandServer(t, ctx, store, "prod-a", &group.ID)
	other := seedCommandServer(t, ctx, store, "other", nil)

	global := createFavorite(t, ctx, service, domain.SaveCommandFavoriteRequest{
		Title: "Global disk", Command: "df -h", Scope: domain.CommandScopeGlobal,
	})
	groupFavorite := createFavorite(t, ctx, service, domain.SaveCommandFavoriteRequest{
		Title: "Group journal", Command: "journalctl -xe", Scope: domain.CommandScopeGroup, GroupID: &group.ID,
	})
	serverFavorite := createFavorite(t, ctx, service, domain.SaveCommandFavoriteRequest{
		Title: "Server service", Command: "systemctl status nginx", Scope: domain.CommandScopeServer, ServerID: &server.ID,
	})
	if _, err := service.IncrementFavoriteUse(ctx, global.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.IncrementFavoriteUse(ctx, groupFavorite.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.IncrementFavoriteUse(ctx, serverFavorite.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID: server.ID, SessionID: "s1", Command: "systemctl status nginx",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID: server.ID, SessionID: "s1", Command: "systemctl restart nginx",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID: other.ID, SessionID: "s2", Command: "systemctl status other",
	}); err != nil {
		t.Fatal(err)
	}

	suggestions, err := service.ListSuggestions(ctx, domain.ListCommandSuggestionsRequest{
		ServerID: server.ID, GroupID: &group.ID, Prefix: "system", Limit: 20,
		IncludeHistory: true, IncludeFavorites: true, IncludeBuiltins: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(suggestions) == 0 {
		t.Fatal("expected suggestions")
	}
	if suggestions[0].Source != "history" || suggestions[0].Command != "systemctl restart nginx" || suggestions[0].Kind != "command" {
		t.Fatalf("recent history should sort before favorites and builtins: %+v", suggestions)
	}
	seen := map[string]int{}
	for _, suggestion := range suggestions {
		if !strings.HasPrefix(suggestion.Command, "system") {
			t.Fatalf("prefix leak: %+v", suggestion)
		}
		seen[suggestion.Command]++
	}
	if seen["systemctl status nginx"] != 1 {
		t.Fatalf("dedupe failed, seen=%+v suggestions=%+v", seen, suggestions)
	}
	if seen["systemctl status other"] != 0 {
		t.Fatalf("other server history leaked: %+v", suggestions)
	}
}

func TestCommandSuggestionsBuiltinsSensitivePrefixAndLimit(t *testing.T) {
	ctx := context.Background()
	store := newCommandStore(t)
	service := New(store)
	server := seedCommandServer(t, ctx, store, "prod", nil)
	if _, err := service.RecordHistory(ctx, domain.RecordCommandHistoryRequest{
		ServerID: server.ID, SessionID: "s1", Command: "curl -H 'Authorization: Bearer secret' https://example.invalid",
	}); err != nil {
		t.Fatal(err)
	}

	sensitive, err := service.ListSuggestions(ctx, domain.ListCommandSuggestionsRequest{
		ServerID: server.ID, Prefix: "token=", Limit: 20,
		IncludeHistory: true, IncludeFavorites: true, IncludeBuiltins: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(sensitive) != 0 {
		t.Fatalf("sensitive prefix returned suggestions: %+v", sensitive)
	}

	limited, err := service.ListSuggestions(ctx, domain.ListCommandSuggestionsRequest{
		ServerID: server.ID, Prefix: "", Limit: 3,
		IncludeHistory: false, IncludeFavorites: false, IncludeBuiltins: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(limited) != 3 {
		t.Fatalf("limit not applied: %+v", limited)
	}
	for _, suggestion := range limited {
		if suggestion.Source != "builtin" || suggestion.Scope != domain.CommandScopeBuiltin {
			t.Fatalf("expected builtin suggestion: %+v", suggestion)
		}
		if suggestion.Kind != "command" && suggestion.Kind != "argument" && suggestion.Kind != "snippet" {
			t.Fatalf("builtin suggestion kind not classified: %+v", suggestion)
		}
	}
}

func newCommandStore(t *testing.T) *persistence.Store {
	t.Helper()
	store, err := persistence.Open(context.Background(), filepath.Join(t.TempDir(), "commands.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func seedCommandServer(
	t *testing.T,
	ctx context.Context,
	store *persistence.Store,
	name string,
	groupID *int64,
) domain.Connection {
	t.Helper()
	connection, err := store.SaveConnection(ctx, domain.SaveConnectionRequest{
		GroupID: groupID, Name: name, Host: name + ".example.invalid", Port: 22,
		Username: "root", AuthType: domain.AuthPassword, RefreshInterval: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	return connection
}

func createFavorite(
	t *testing.T,
	ctx context.Context,
	service *Service,
	request domain.SaveCommandFavoriteRequest,
) domain.CommandFavorite {
	t.Helper()
	favorite, err := service.CreateFavorite(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	return favorite
}

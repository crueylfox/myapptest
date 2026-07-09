package commands

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"hostdeck/internal/domain"
)

const (
	maxCommandLength = 32 * 1024
)

var ErrFavoriteSensitiveConfirmation = errors.New("COMMAND_FAVORITE_SENSITIVE_CONFIRM: 命令可能包含敏感信息，请确认后再保存")

type Store interface {
	ListCommandHistory(context.Context, domain.ListCommandHistoryRequest) ([]domain.CommandHistoryEntry, error)
	LatestCommandHistory(context.Context, int64) (domain.CommandHistoryEntry, bool, error)
	FindCommandHistoryByHash(context.Context, int64, string) (domain.CommandHistoryEntry, bool, error)
	InsertCommandHistory(context.Context, domain.CommandHistoryEntry) error
	InsertBatchCommandHistory(context.Context, domain.CommandHistoryEntry, []int64, string) (domain.CommandHistoryEntry, error)
	UpdateCommandHistoryExecution(context.Context, string, string, string) (domain.CommandHistoryEntry, error)
	UpdateCommandHistory(context.Context, domain.UpdateCommandHistoryRequest, string) (domain.CommandHistoryEntry, error)
	DeleteCommandHistory(context.Context, string) error
	ClearCommandHistory(context.Context, int64) error
	PruneCommandHistory(context.Context, int64, int) error
	PruneBatchCommandHistory(context.Context, int) error

	ListCommandFavorites(context.Context, domain.ListCommandFavoritesRequest) ([]domain.CommandFavorite, error)
	CreateCommandFavorite(context.Context, domain.CommandFavorite) (domain.CommandFavorite, error)
	UpdateCommandFavorite(context.Context, domain.SaveCommandFavoriteRequest) (domain.CommandFavorite, error)
	DeleteCommandFavorite(context.Context, string) error
	IncrementCommandFavoriteUse(context.Context, string, string) (domain.CommandFavorite, error)
}

type Service struct {
	store                Store
	historyLimitProvider func() int
}

func New(store Store) *Service {
	return NewWithHistoryLimit(store, nil)
}

func NewWithHistoryLimit(store Store, provider func() int) *Service {
	return &Service{store: store, historyLimitProvider: provider}
}

func (s *Service) RecordHistory(
	ctx context.Context,
	request domain.RecordCommandHistoryRequest,
) (domain.RecordCommandHistoryResult, error) {
	command := domain.NormalizeHistoryCommand(request.Command)
	safety := CheckCommandSafety(command)
	if !safety.Safe {
		return domain.RecordCommandHistoryResult{
			Recorded:   false,
			Skipped:    true,
			ReasonCode: safety.ReasonCode,
			Message:    safety.Message,
		}, nil
	}
	if request.ServerID <= 0 {
		return domain.RecordCommandHistoryResult{}, errors.New("COMMAND_HISTORY_INVALID: 服务器 ID 无效")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	hash := CommandHash(command)
	latest, ok, err := s.store.LatestCommandHistory(ctx, request.ServerID)
	if err != nil {
		return domain.RecordCommandHistoryResult{}, err
	}
	if ok && latest.CommandHash == hash {
		entry, err := s.store.UpdateCommandHistoryExecution(ctx, latest.ID, request.SessionID, now)
		if err != nil {
			return domain.RecordCommandHistoryResult{}, err
		}
		return domain.RecordCommandHistoryResult{Recorded: true, Entry: &entry}, nil
	}
	existing, ok, err := s.store.FindCommandHistoryByHash(ctx, request.ServerID, hash)
	if err != nil {
		return domain.RecordCommandHistoryResult{}, err
	}
	if ok {
		entry, err := s.store.UpdateCommandHistoryExecution(ctx, existing.ID, request.SessionID, now)
		if err != nil {
			return domain.RecordCommandHistoryResult{}, err
		}
		return domain.RecordCommandHistoryResult{Recorded: true, Entry: &entry}, nil
	}
	entry := domain.CommandHistoryEntry{
		ID:          newID("cmdhist"),
		ServerID:    request.ServerID,
		SessionID:   strings.TrimSpace(request.SessionID),
		Command:     command,
		CommandHash: hash,
		Source:      sourceOrDefault(request.Source),
		ExecutedAt:  now,
	}
	entry = domain.EnrichCommandHistoryEntry(entry)
	if err := s.store.InsertCommandHistory(ctx, entry); err != nil {
		return domain.RecordCommandHistoryResult{}, err
	}
	if err := s.store.PruneCommandHistory(ctx, request.ServerID, s.historyLimit()); err != nil {
		return domain.RecordCommandHistoryResult{}, err
	}
	return domain.RecordCommandHistoryResult{Recorded: true, Entry: &entry}, nil
}

func (s *Service) RecordBatchHistory(
	ctx context.Context,
	request domain.RecordBatchCommandHistoryRequest,
) (domain.RecordBatchCommandHistoryResult, error) {
	command := domain.NormalizeHistoryCommand(request.Command)
	safety := CheckCommandSafety(command)
	if !safety.Safe {
		return domain.RecordBatchCommandHistoryResult{
			Recorded:   false,
			Skipped:    true,
			ReasonCode: safety.ReasonCode,
			Message:    safety.Message,
		}, nil
	}
	targetServerIDs := uniquePositiveInt64s(request.SuccessfulServerIDs)
	if len(targetServerIDs) == 0 {
		return domain.RecordBatchCommandHistoryResult{
			Recorded:   false,
			Skipped:    true,
			ReasonCode: "NO_TARGETS",
			Message:    "没有成功发送的服务器，未保存历史记录",
		}, nil
	}
	submissionID := strings.TrimSpace(request.SubmissionID)
	if submissionID == "" {
		submissionID = newID("batchsubmission")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	entry := domain.CommandHistoryEntry{
		ID:                newID("cmdhist"),
		Command:           command,
		CommandHash:       CommandHash(command),
		Source:            "batch",
		SourceLabel:       "批量",
		ExecutedAt:        now,
		TargetServerIDs:   targetServerIDs,
		TargetCount:       len(targetServerIDs),
		BatchSubmissionID: submissionID,
	}
	entry = domain.EnrichCommandHistoryEntry(entry)
	entry, err := s.store.InsertBatchCommandHistory(ctx, entry, targetServerIDs, submissionID)
	if err != nil {
		return domain.RecordBatchCommandHistoryResult{}, err
	}
	if err := s.store.PruneBatchCommandHistory(ctx, s.historyLimit()); err != nil {
		return domain.RecordBatchCommandHistoryResult{}, err
	}
	return domain.RecordBatchCommandHistoryResult{
		Recorded:    true,
		HistoryID:   entry.ID,
		TargetCount: entry.TargetCount,
		Entry:       &entry,
	}, nil
}

func (s *Service) ListHistory(
	ctx context.Context,
	request domain.ListCommandHistoryRequest,
) ([]domain.CommandHistoryEntry, error) {
	if request.Scope == "" {
		request.Scope = domain.CommandListScopeCurrentServer
	}
	if request.Scope != domain.CommandListScopeAll && request.ServerID <= 0 {
		return nil, errors.New("COMMAND_HISTORY_INVALID: 服务器 ID 无效")
	}
	if request.Limit <= 0 {
		request.Limit = s.historyLimit()
	} else if request.Limit > s.historyLimit() {
		request.Limit = s.historyLimit()
	}
	entries, err := s.store.ListCommandHistory(ctx, request)
	if entries == nil {
		entries = []domain.CommandHistoryEntry{}
	}
	for index := range entries {
		entries[index] = domain.EnrichCommandHistoryEntry(entries[index])
	}
	return entries, err
}

func (s *Service) DeleteHistory(ctx context.Context, id string) error {
	return s.store.DeleteCommandHistory(ctx, strings.TrimSpace(id))
}

func (s *Service) UpdateHistory(
	ctx context.Context,
	request domain.UpdateCommandHistoryRequest,
) (domain.UpdateCommandHistoryResult, error) {
	request.ID = strings.TrimSpace(request.ID)
	if request.ID == "" {
		return domain.UpdateCommandHistoryResult{}, errors.New("COMMAND_HISTORY_INVALID: 历史 ID 不能为空")
	}
	command := domain.NormalizeHistoryCommand(request.Command)
	safety := CheckCommandSafety(command)
	if !safety.Safe {
		return domain.UpdateCommandHistoryResult{}, fmt.Errorf("COMMAND_HISTORY_INVALID: %s", safety.Message)
	}
	request.Command = command
	entry, err := s.store.UpdateCommandHistory(ctx, request, CommandHash(command))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.UpdateCommandHistoryResult{}, errors.New("COMMAND_HISTORY_NOT_FOUND: 历史记录不存在")
		}
		return domain.UpdateCommandHistoryResult{}, err
	}
	return domain.UpdateCommandHistoryResult{Entry: entry}, nil
}

func (s *Service) ClearHistory(ctx context.Context, serverID int64) error {
	if serverID <= 0 {
		return errors.New("COMMAND_HISTORY_INVALID: 服务器 ID 无效")
	}
	return s.store.ClearCommandHistory(ctx, serverID)
}

func (s *Service) ListFavorites(
	ctx context.Context,
	request domain.ListCommandFavoritesRequest,
) ([]domain.CommandFavorite, error) {
	if request.Scope == "" {
		request.Scope = domain.CommandListScopeCurrentServer
	}
	favorites, err := s.store.ListCommandFavorites(ctx, request)
	if favorites == nil {
		favorites = []domain.CommandFavorite{}
	}
	return favorites, err
}

func (s *Service) ListSuggestions(
	ctx context.Context,
	request domain.ListCommandSuggestionsRequest,
) ([]domain.CommandSuggestion, error) {
	if request.ServerID <= 0 {
		return nil, errors.New("COMMAND_COMPLETION_INVALID: 服务器 ID 无效")
	}
	prefix := strings.TrimSpace(request.Prefix)
	if prefix != "" {
		if safety := CheckCommandSafety(prefix); !safety.Safe {
			return []domain.CommandSuggestion{}, nil
		}
	}
	limit := request.Limit
	if limit <= 0 || limit > 20 {
		limit = 20
	}

	var candidates []domain.CommandSuggestion
	if request.IncludeFavorites {
		favorites, err := s.ListFavorites(ctx, domain.ListCommandFavoritesRequest{
			ServerID: request.ServerID,
			GroupID:  request.GroupID,
			Query:    "",
		})
		if err != nil {
			return nil, err
		}
		for _, favorite := range favorites {
			if suggestionCommandFiltered(favorite.Command, prefix) {
				continue
			}
			scopeRank := suggestionScopeRank(favorite.Scope)
			candidates = append(candidates, domain.CommandSuggestion{
				ID:          favorite.ID,
				Source:      "favorite",
				Kind:        "command",
				Title:       favorite.Title,
				Command:     favorite.Command,
				Description: favorite.Description,
				Scope:       favorite.Scope,
				ServerID:    favorite.ServerID,
				GroupID:     favorite.GroupID,
				Score:       scoreSuggestion(2+scopeRank, favorite.UseCount, favorite.LastUsedAt, favorite.Command),
				UseCount:    favorite.UseCount,
				LastUsedAt:  favorite.LastUsedAt,
			})
		}
	}
	if request.IncludeHistory {
		history, err := s.ListHistory(ctx, domain.ListCommandHistoryRequest{
			ServerID: request.ServerID,
			Query:    prefix,
			Limit:    200,
		})
		if err != nil {
			return nil, err
		}
		for _, entry := range history {
			if suggestionCommandFiltered(entry.Command, prefix) {
				continue
			}
			candidates = append(candidates, domain.CommandSuggestion{
				ID:         entry.ID,
				Source:     "history",
				Kind:       "command",
				Title:      entry.Command,
				Command:    entry.Command,
				Scope:      domain.CommandScopeServer,
				ServerID:   suggestionServerID(entry, request.ServerID),
				Score:      scoreSuggestion(1, 0, entry.ExecutedAt, entry.Command),
				LastUsedAt: entry.ExecutedAt,
			})
		}
	}
	if request.IncludeBuiltins {
		for _, item := range builtinCommandSuggestions {
			if suggestionCommandFiltered(item.Command, prefix) {
				continue
			}
			candidates = append(candidates, domain.CommandSuggestion{
				ID:          item.ID,
				Source:      "builtin",
				Kind:        item.Kind,
				Title:       item.Title,
				Command:     item.Command,
				Description: item.Description,
				Scope:       domain.CommandScopeBuiltin,
				Score:       scoreSuggestion(6, 0, "", item.Command),
			})
		}
	}

	candidates = dedupeSuggestions(candidates)
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].Score != candidates[j].Score {
			return candidates[i].Score > candidates[j].Score
		}
		if candidates[i].LastUsedAt != candidates[j].LastUsedAt {
			return candidates[i].LastUsedAt > candidates[j].LastUsedAt
		}
		if candidates[i].UseCount != candidates[j].UseCount {
			return candidates[i].UseCount > candidates[j].UseCount
		}
		if len([]rune(candidates[i].Command)) != len([]rune(candidates[j].Command)) {
			return len([]rune(candidates[i].Command)) < len([]rune(candidates[j].Command))
		}
		return candidates[i].Command < candidates[j].Command
	})
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	return candidates, nil
}

func (s *Service) CreateFavorite(
	ctx context.Context,
	request domain.SaveCommandFavoriteRequest,
) (domain.CommandFavorite, error) {
	if err := validateFavorite(request); err != nil {
		return domain.CommandFavorite{}, err
	}
	if !request.AllowSensitive {
		if safety := CheckFavoriteSafety(request.Command); !safety.Safe {
			return domain.CommandFavorite{}, ErrFavoriteSensitiveConfirmation
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	favorite := domain.CommandFavorite{
		ID:          newID("cmdfav"),
		Title:       strings.TrimSpace(request.Title),
		Command:     domain.NormalizeHistoryCommand(request.Command),
		Description: strings.TrimSpace(request.Description),
		Scope:       request.Scope,
		ServerID:    request.ServerID,
		GroupID:     request.GroupID,
		Tags:        normalizeTags(request.Tags),
		SortOrder:   request.SortOrder,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	return s.store.CreateCommandFavorite(ctx, favorite)
}

func (s *Service) UpdateFavorite(
	ctx context.Context,
	request domain.SaveCommandFavoriteRequest,
) (domain.CommandFavorite, error) {
	request.ID = strings.TrimSpace(request.ID)
	if request.ID == "" {
		return domain.CommandFavorite{}, errors.New("COMMAND_FAVORITE_INVALID: 收藏 ID 不能为空")
	}
	if err := validateFavorite(request); err != nil {
		return domain.CommandFavorite{}, err
	}
	if !request.AllowSensitive {
		if safety := CheckFavoriteSafety(request.Command); !safety.Safe {
			return domain.CommandFavorite{}, ErrFavoriteSensitiveConfirmation
		}
	}
	request.Title = strings.TrimSpace(request.Title)
	request.Command = domain.NormalizeHistoryCommand(request.Command)
	request.Description = strings.TrimSpace(request.Description)
	request.Tags = normalizeTags(request.Tags)
	return s.store.UpdateCommandFavorite(ctx, request)
}

func (s *Service) DeleteFavorite(ctx context.Context, id string) error {
	return s.store.DeleteCommandFavorite(ctx, strings.TrimSpace(id))
}

func (s *Service) IncrementFavoriteUse(ctx context.Context, id string) (domain.CommandFavorite, error) {
	return s.store.IncrementCommandFavoriteUse(ctx, strings.TrimSpace(id), time.Now().UTC().Format(time.RFC3339Nano))
}

func CheckFavoriteSafety(command string) domain.CommandSafetyResult {
	return CheckCommandSafety(domain.NormalizeHistoryCommand(command))
}

func CheckCommandSafety(command string) domain.CommandSafetyResult {
	command = domain.NormalizeHistoryCommand(command)
	switch {
	case command == "":
		return unsafe("EMPTY", "空命令不会进入历史记录")
	case len([]rune(command)) > maxCommandLength:
		return unsafe("TOO_LONG", "命令超过 32768 个字符，已跳过历史记录")
	case containsControlSequence(command):
		return unsafe("CONTROL_SEQUENCE", "控制序列不会进入历史记录")
	case looksSensitive(command):
		return unsafe("SENSITIVE", "该命令可能包含敏感信息，已跳过历史记录")
	default:
		return domain.CommandSafetyResult{Safe: true}
	}
}

func CommandHash(command string) string {
	normalized := domain.NormalizeHistoryCommand(command)
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

func validateFavorite(request domain.SaveCommandFavoriteRequest) error {
	if strings.TrimSpace(request.Title) == "" {
		return errors.New("COMMAND_FAVORITE_INVALID: 标题不能为空")
	}
	normalizedCommand := domain.NormalizeHistoryCommand(request.Command)
	if normalizedCommand == "" {
		return errors.New("COMMAND_FAVORITE_INVALID: 命令不能为空")
	}
	if len([]rune(normalizedCommand)) > maxCommandLength {
		return errors.New("COMMAND_FAVORITE_INVALID: 命令不能超过 32768 个字符")
	}
	switch request.Scope {
	case domain.CommandScopeGlobal:
	case domain.CommandScopeGroup:
		if request.GroupID == nil || *request.GroupID <= 0 {
			return errors.New("COMMAND_FAVORITE_INVALID: 分组收藏需要有效分组")
		}
	case domain.CommandScopeServer:
		if request.ServerID == nil || *request.ServerID <= 0 {
			return errors.New("COMMAND_FAVORITE_INVALID: 服务器收藏需要有效服务器")
		}
	default:
		return errors.New("COMMAND_FAVORITE_INVALID: 收藏范围无效")
	}
	return nil
}

func normalizeTags(tags []string) []string {
	out := make([]string, 0, len(tags))
	seen := map[string]bool{}
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || seen[strings.ToLower(tag)] {
			continue
		}
		seen[strings.ToLower(tag)] = true
		out = append(out, tag)
	}
	return out
}

func sourceOrDefault(source string) string {
	source = strings.TrimSpace(source)
	if source == "" {
		return "terminal"
	}
	return source
}

func uniquePositiveInt64s(values []int64) []int64 {
	seen := make(map[int64]bool, len(values))
	out := make([]int64, 0, len(values))
	for _, value := range values {
		if value <= 0 || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func suggestionServerID(entry domain.CommandHistoryEntry, fallback int64) *int64 {
	serverID := entry.ServerID
	if serverID <= 0 {
		serverID = fallback
	}
	if serverID <= 0 {
		return nil
	}
	return &serverID
}

func (s *Service) historyLimit() int {
	if s == nil || s.historyLimitProvider == nil {
		return domain.DefaultCommandHistoryMaxEntries
	}
	value := s.historyLimitProvider()
	if value == 0 {
		return domain.DefaultCommandHistoryMaxEntries
	}
	if value < domain.MinimumCommandHistoryMaxEntries {
		return domain.MinimumCommandHistoryMaxEntries
	}
	if value > domain.MaximumCommandHistoryMaxEntries {
		return domain.MaximumCommandHistoryMaxEntries
	}
	return value
}

func unsafe(code, message string) domain.CommandSafetyResult {
	return domain.CommandSafetyResult{Safe: false, ReasonCode: code, Message: message}
}

func containsControlSequence(command string) bool {
	for _, r := range command {
		if r == '\t' || r == '\n' {
			continue
		}
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

var sensitivePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\bpassword\s*=`),
	regexp.MustCompile(`(?i)\bpasswd\s*=`),
	regexp.MustCompile(`(?i)\bpass\s*=`),
	regexp.MustCompile(`(?i)\btoken\s*=`),
	regexp.MustCompile(`(?i)\bsecret\s*=`),
	regexp.MustCompile(`(?i)\bapi_key\s*=`),
	regexp.MustCompile(`(?i)\bapikey\s*=`),
	regexp.MustCompile(`(?i)\bauthorization\s*:`),
	regexp.MustCompile(`(?i)private key`),
	regexp.MustCompile(`(?i)\bsshpass\s+-p\b`),
	regexp.MustCompile(`(?i)\bmysql\b.*\s-p\S+`),
	regexp.MustCompile(`(?i)\bcurl\b.*\s-u\s+\S+:\S+`),
}

func looksSensitive(command string) bool {
	command = domain.NormalizeHistoryCommand(command)
	flattened := strings.Join(strings.Fields(command), " ")
	for _, pattern := range sensitivePatterns {
		if pattern.MatchString(command) || pattern.MatchString(flattened) {
			return true
		}
	}
	return false
}

type builtinCommandSuggestion struct {
	ID          string
	Kind        string
	Title       string
	Command     string
	Description string
}

var builtinCommandSuggestions = []builtinCommandSuggestion{
	{ID: "builtin-ls-la", Kind: "command", Title: "List files", Command: "ls -la", Description: "List files with details"},
	{ID: "builtin-cd", Kind: "command", Title: "Change directory", Command: "cd", Description: "Change current directory"},
	{ID: "builtin-pwd", Kind: "command", Title: "Print directory", Command: "pwd", Description: "Show current directory"},
	{ID: "builtin-cat", Kind: "command", Title: "Print file", Command: "cat", Description: "Print file content"},
	{ID: "builtin-less", Kind: "command", Title: "Page file", Command: "less", Description: "Page through file content"},
	{ID: "builtin-tail-f", Kind: "command", Title: "Follow log", Command: "tail -f", Description: "Follow appended file output"},
	{ID: "builtin-grep-r", Kind: "argument", Title: "Recursive grep", Command: "grep -R \"pattern\" /path", Description: "Search files recursively"},
	{ID: "builtin-find-name", Kind: "argument", Title: "Find by name", Command: "find /path -name \"pattern\"", Description: "Find files by name"},
	{ID: "builtin-df-h", Kind: "command", Title: "Disk usage", Command: "df -h", Description: "Show filesystem usage"},
	{ID: "builtin-du-sh", Kind: "command", Title: "Directory sizes", Command: "du -sh *", Description: "Summarize directory sizes"},
	{ID: "builtin-free-h", Kind: "command", Title: "Memory usage", Command: "free -h", Description: "Show memory usage"},
	{ID: "builtin-uptime", Kind: "command", Title: "Uptime", Command: "uptime", Description: "Show uptime and load"},
	{ID: "builtin-top", Kind: "command", Title: "Top", Command: "top", Description: "Interactive process monitor"},
	{ID: "builtin-htop", Kind: "command", Title: "Htop", Command: "htop", Description: "Interactive process monitor"},
	{ID: "builtin-ps-aux", Kind: "command", Title: "Processes", Command: "ps aux", Description: "List processes"},
	{ID: "builtin-systemctl-status", Kind: "argument", Title: "Service status", Command: "systemctl status", Description: "Inspect systemd service"},
	{ID: "builtin-systemctl-restart", Kind: "argument", Title: "Restart service", Command: "systemctl restart", Description: "Restart systemd service"},
	{ID: "builtin-journalctl-u", Kind: "argument", Title: "Service logs", Command: "journalctl -u service -f", Description: "Follow systemd unit logs"},
	{ID: "builtin-journalctl-xe", Kind: "command", Title: "System journal", Command: "journalctl -xe", Description: "Show recent journal errors"},
	{ID: "builtin-ip-addr", Kind: "command", Title: "IP addresses", Command: "ip addr", Description: "Show network addresses"},
	{ID: "builtin-ip-route", Kind: "command", Title: "IP routes", Command: "ip route", Description: "Show routing table"},
	{ID: "builtin-ss", Kind: "command", Title: "Listening sockets", Command: "ss -tulnp", Description: "Show listening sockets"},
	{ID: "builtin-netstat", Kind: "command", Title: "Listening sockets", Command: "netstat -tulnp", Description: "Show listening sockets"},
	{ID: "builtin-ping", Kind: "argument", Title: "Ping", Command: "ping -c 4 host", Description: "Test ICMP reachability"},
	{ID: "builtin-traceroute", Kind: "argument", Title: "Traceroute", Command: "traceroute host", Description: "Trace network path"},
	{ID: "builtin-dig", Kind: "argument", Title: "DNS lookup", Command: "dig example.com", Description: "Query DNS records"},
	{ID: "builtin-nslookup", Kind: "argument", Title: "DNS lookup", Command: "nslookup example.com", Description: "Query DNS records"},
	{ID: "builtin-curl-head", Kind: "argument", Title: "HTTP headers", Command: "curl -I https://example.com", Description: "Fetch HTTP headers"},
	{ID: "builtin-wget-spider", Kind: "argument", Title: "HTTP check", Command: "wget --spider https://example.com", Description: "Check remote URL"},
	{ID: "builtin-chmod", Kind: "argument", Title: "Change mode", Command: "chmod 0644 path", Description: "Change file permissions"},
	{ID: "builtin-chown", Kind: "argument", Title: "Change owner", Command: "chown user:group path", Description: "Change file owner"},
	{ID: "builtin-tar-czf", Kind: "argument", Title: "Create tar.gz", Command: "tar -czf archive.tar.gz path", Description: "Create gzip tar archive"},
	{ID: "builtin-tar-xzf", Kind: "argument", Title: "Extract tar.gz", Command: "tar -xzf archive.tar.gz", Description: "Extract gzip tar archive"},
	{ID: "builtin-docker-ps", Kind: "command", Title: "Docker containers", Command: "docker ps", Description: "List running containers"},
	{ID: "builtin-docker-logs", Kind: "argument", Title: "Docker logs", Command: "docker logs --tail 200 -f container", Description: "Follow container logs"},
	{ID: "builtin-docker-restart", Kind: "argument", Title: "Docker restart", Command: "docker restart container", Description: "Restart container"},
	{ID: "builtin-opkg-update", Kind: "command", Title: "OpenWrt package update", Command: "opkg update", Description: "Refresh OpenWrt package index"},
	{ID: "builtin-opkg-installed", Kind: "command", Title: "OpenWrt packages", Command: "opkg list-installed", Description: "List installed OpenWrt packages"},
	{ID: "builtin-logread-f", Kind: "command", Title: "OpenWrt logs", Command: "logread -f", Description: "Follow OpenWrt system log"},
	{ID: "builtin-uci-show", Kind: "argument", Title: "OpenWrt UCI", Command: "uci show", Description: "Show OpenWrt UCI configuration"},
	{ID: "builtin-ubus-board", Kind: "command", Title: "OpenWrt board info", Command: "ubus call system board", Description: "Show OpenWrt board information"},
	{ID: "builtin-nginx-t", Kind: "command", Title: "Nginx test", Command: "nginx -t", Description: "Test nginx config"},
	{ID: "builtin-crontab-e", Kind: "command", Title: "Edit crontab", Command: "crontab -e", Description: "Edit user crontab"},
}

func suggestionCommandFiltered(command, prefix string) bool {
	command = strings.TrimSpace(command)
	if command == "" {
		return true
	}
	if safety := CheckCommandSafety(command); !safety.Safe {
		return true
	}
	if prefix == "" {
		return false
	}
	return !strings.HasPrefix(strings.ToLower(command), strings.ToLower(prefix))
}

func suggestionScopeRank(scope domain.CommandScope) int {
	switch scope {
	case domain.CommandScopeServer:
		return 1
	case domain.CommandScopeGroup:
		return 2
	case domain.CommandScopeGlobal:
		return 3
	default:
		return 5
	}
}

func scoreSuggestion(sourceRank int, useCount int, lastUsedAt string, command string) int {
	score := (10 - sourceRank) * 100000
	if lastUsedAt != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, lastUsedAt); err == nil {
			ageHours := int(time.Since(parsed).Hours())
			if ageHours < 0 {
				ageHours = 0
			}
			score += max(0, 20000-ageHours)
		}
	}
	score += min(useCount, 1000) * 10
	return score
}

func dedupeSuggestions(input []domain.CommandSuggestion) []domain.CommandSuggestion {
	byCommand := make(map[string]domain.CommandSuggestion, len(input))
	for _, item := range input {
		key := strings.ToLower(strings.TrimSpace(item.Command))
		if key == "" {
			continue
		}
		existing, ok := byCommand[key]
		if !ok || item.Score > existing.Score {
			byCommand[key] = item
		}
	}
	output := make([]domain.CommandSuggestion, 0, len(byCommand))
	for _, item := range byCommand {
		output = append(output, item)
	}
	return output
}

func newID(prefix string) string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(raw[:])
}

package domain

import "strings"

type CommandScope string
type CommandListScope string

const (
	CommandScopeGlobal  CommandScope = "global"
	CommandScopeGroup   CommandScope = "group"
	CommandScopeServer  CommandScope = "server"
	CommandScopeBuiltin CommandScope = "builtin"

	CommandListScopeAll           CommandListScope = "all"
	CommandListScopeCurrentServer CommandListScope = "currentServer"
)

type CommandHistoryEntry struct {
	ID                string  `json:"id"`
	ServerID          int64   `json:"serverId"`
	ServerName        string  `json:"serverName"`
	SessionID         string  `json:"sessionId"`
	Command           string  `json:"command"`
	Preview           string  `json:"preview"`
	IsMultiline       bool    `json:"isMultiline"`
	CommandHash       string  `json:"commandHash"`
	Source            string  `json:"source"`
	SourceLabel       string  `json:"sourceLabel"`
	ExecutedAt        string  `json:"executedAt"`
	TargetServerIDs   []int64 `json:"targetServerIds,omitempty"`
	TargetCount       int     `json:"targetCount"`
	BatchSubmissionID string  `json:"batchSubmissionId,omitempty"`
}

type RecordCommandHistoryRequest struct {
	ServerID  int64  `json:"serverId"`
	SessionID string `json:"sessionId"`
	Command   string `json:"command"`
	Source    string `json:"source"`
}

type RecordCommandHistoryResult struct {
	Recorded   bool                 `json:"recorded"`
	Skipped    bool                 `json:"skipped"`
	ReasonCode string               `json:"reasonCode"`
	Message    string               `json:"message"`
	Entry      *CommandHistoryEntry `json:"entry,omitempty"`
}

type RecordBatchCommandHistoryRequest struct {
	Command             string  `json:"command"`
	SuccessfulServerIDs []int64 `json:"successfulServerIds"`
	SubmissionID        string  `json:"submissionId"`
}

type RecordBatchCommandHistoryResult struct {
	Recorded    bool                 `json:"recorded"`
	Skipped     bool                 `json:"skipped"`
	ReasonCode  string               `json:"reasonCode"`
	Message     string               `json:"message"`
	HistoryID   string               `json:"historyId"`
	TargetCount int                  `json:"targetCount"`
	Entry       *CommandHistoryEntry `json:"entry,omitempty"`
}

type UpdateCommandHistoryRequest struct {
	ID      string `json:"id"`
	Command string `json:"command"`
}

type UpdateCommandHistoryResult struct {
	Entry CommandHistoryEntry `json:"entry"`
}

type ListCommandHistoryRequest struct {
	ServerID int64            `json:"serverId"`
	Scope    CommandListScope `json:"scope"`
	Query    string           `json:"query"`
	Limit    int              `json:"limit"`
}

type CommandFavorite struct {
	ID          string       `json:"id"`
	Title       string       `json:"title"`
	Command     string       `json:"command"`
	Description string       `json:"description"`
	Scope       CommandScope `json:"scope"`
	ServerID    *int64       `json:"serverId"`
	ServerName  string       `json:"serverName"`
	GroupID     *int64       `json:"groupId"`
	GroupName   string       `json:"groupName"`
	Tags        []string     `json:"tags"`
	SortOrder   int          `json:"sortOrder"`
	UseCount    int          `json:"useCount"`
	CreatedAt   string       `json:"createdAt"`
	UpdatedAt   string       `json:"updatedAt"`
	LastUsedAt  string       `json:"lastUsedAt"`
}

type ListCommandFavoritesRequest struct {
	ServerID int64            `json:"serverId"`
	GroupID  *int64           `json:"groupId"`
	Scope    CommandListScope `json:"scope"`
	Query    string           `json:"query"`
}

type ListCommandSuggestionsRequest struct {
	ServerID         int64  `json:"serverId"`
	GroupID          *int64 `json:"groupId"`
	Prefix           string `json:"prefix"`
	Limit            int    `json:"limit"`
	IncludeHistory   bool   `json:"includeHistory"`
	IncludeFavorites bool   `json:"includeFavorites"`
	IncludeBuiltins  bool   `json:"includeBuiltins"`
}

type CommandSuggestion struct {
	ID          string       `json:"id"`
	Source      string       `json:"source"`
	Kind        string       `json:"kind"`
	Title       string       `json:"title"`
	Command     string       `json:"command"`
	Description string       `json:"description"`
	Scope       CommandScope `json:"scope"`
	ServerID    *int64       `json:"serverId"`
	GroupID     *int64       `json:"groupId"`
	Score       int          `json:"score"`
	UseCount    int          `json:"useCount"`
	LastUsedAt  string       `json:"lastUsedAt"`
}

type SaveCommandFavoriteRequest struct {
	ID             string       `json:"id"`
	Title          string       `json:"title"`
	Command        string       `json:"command"`
	Description    string       `json:"description"`
	Scope          CommandScope `json:"scope"`
	ServerID       *int64       `json:"serverId"`
	GroupID        *int64       `json:"groupId"`
	Tags           []string     `json:"tags"`
	SortOrder      int          `json:"sortOrder"`
	AllowSensitive bool         `json:"allowSensitive"`
}

type CommandSafetyResult struct {
	Safe       bool   `json:"safe"`
	ReasonCode string `json:"reasonCode"`
	Message    string `json:"message"`
}

func NormalizeHistoryCommand(command string) string {
	command = strings.ReplaceAll(command, "\r\n", "\n")
	command = strings.ReplaceAll(command, "\r", "\n")
	return strings.TrimSpace(command)
}

func IsMultilineHistoryCommand(command string) bool {
	lines := strings.Split(NormalizeHistoryCommand(command), "\n")
	nonEmpty := 0
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		nonEmpty++
		if nonEmpty >= 2 {
			return true
		}
	}
	return false
}

func BuildCommandPreview(command string) string {
	normalized := NormalizeHistoryCommand(command)
	if normalized == "" {
		return ""
	}
	lines := strings.Split(normalized, "\n")
	preview := ""
	hasMore := false
	for index, line := range lines {
		collapsed := strings.Join(strings.Fields(line), " ")
		if collapsed == "" {
			continue
		}
		preview = collapsed
		for _, remaining := range lines[index+1:] {
			if strings.TrimSpace(remaining) != "" {
				hasMore = true
				break
			}
		}
		break
	}
	if preview == "" {
		return ""
	}
	if hasMore {
		return preview + " ..."
	}
	return preview
}

func EnrichCommandHistoryEntry(entry CommandHistoryEntry) CommandHistoryEntry {
	entry.Command = NormalizeHistoryCommand(entry.Command)
	entry.Preview = BuildCommandPreview(entry.Command)
	entry.IsMultiline = IsMultilineHistoryCommand(entry.Command)
	return entry
}

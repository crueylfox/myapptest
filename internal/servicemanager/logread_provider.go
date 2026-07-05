package servicemanager

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"serverpilot/internal/domain"
)

const (
	maxLogreadOutputBytes = 512 * 1024
	maxLogreadTailLines   = 2000

	logreadUnavailableMessage        = "OpenWrt logread is not available on this server."
	logreadPermissionMessage         = "permission denied reading OpenWrt logread logs."
	logreadTimeoutMessage            = "OpenWrt logread request timed out."
	logreadFollowUnsupportedMessage  = "OpenWrt logread snapshot refresh is supported, but realtime follow is not supported."
	logreadMissingSentinel           = "serverpilot-logread-missing"
	logreadSourceFallbackDescription = "OpenWrt logread"
)

func logreadSnapshotCommand(lineLimit int) string {
	tailLines := normalizeJournalLineLimit(lineLimit) * 4
	if tailLines > maxLogreadTailLines {
		tailLines = maxLogreadTailLines
	}
	return fmt.Sprintf(
		"if ! command -v logread >/dev/null 2>&1; then printf '%%s\\n' %s >&2; exit 127; fi\nlogread 2>&1 | tail -n %d | dd bs=1 count=%d 2>/dev/null",
		shellQuote(logreadMissingSentinel),
		tailLines,
		maxLogreadOutputBytes,
	)
}

func readLogreadSnapshot(
	ctx context.Context,
	transport Transport,
	serviceID string,
	lineLimit int,
) ([]domain.ServiceJournalLine, bool, error) {
	output, err := transport.Run(ctx, logreadSnapshotCommand(lineLimit))
	if err != nil {
		return nil, false, errors.New(userMessageForLogreadError(err, ""))
	}
	return parseLogreadOutput(serviceID, output, lineLimit)
}

func parseLogreadOutput(serviceID string, output string, lineLimit int) ([]domain.ServiceJournalLine, bool, error) {
	if message := userMessageForLogreadOutput(output); message != "" {
		return nil, false, errors.New(message)
	}
	if len(output) > maxLogreadOutputBytes {
		output = output[:maxLogreadOutputBytes]
	}
	limit := normalizeLogreadParseLineLimit(lineLimit)
	filter := strings.ToLower(strings.TrimSpace(serviceID))
	lines := make([]domain.ServiceJournalLine, 0, limit)
	var sequence int64
	for _, raw := range strings.Split(output, "\n") {
		text := strings.TrimSpace(strings.TrimRight(raw, "\r"))
		if text == "" {
			continue
		}
		if filter != "" && !strings.Contains(strings.ToLower(text), filter) {
			continue
		}
		sequence++
		lines = append(lines, parseLogreadLine(sequence, text))
		if len(lines) > limit {
			lines = lines[len(lines)-limit:]
		}
	}
	for index := range lines {
		lines[index].Sequence = int64(index + 1)
	}
	return lines, true, nil
}

func normalizeLogreadParseLineLimit(value int) int {
	if value > 0 && value <= 1000 {
		return value
	}
	return normalizeJournalLineLimit(value)
}

func parseLogreadLine(sequence int64, text string) domain.ServiceJournalLine {
	fields := strings.Fields(text)
	facilityIndex := -1
	for index, field := range fields {
		if strings.Contains(field, ".") {
			facilityIndex = index
			break
		}
	}
	messageText := text
	timestampText := ""
	identifier := ""
	pid := ""
	priority := -1
	if facilityIndex >= 0 {
		priority = logreadPriority(fields[facilityIndex])
		if facilityIndex > 0 {
			timestampText = strings.Join(fields[:facilityIndex], " ")
		}
		if facilityIndex+1 < len(fields) {
			identifier, pid = parseLogreadIdentifier(fields[facilityIndex+1])
			if facilityIndex+2 < len(fields) {
				messageText = strings.Join(fields[facilityIndex+2:], " ")
			} else {
				messageText = ""
			}
		}
	}
	message, truncated := truncateJournalMessage(messageText)
	return domain.ServiceJournalLine{
		Sequence:      sequence,
		TimestampText: timestampText,
		Priority:      priority,
		PriorityLabel: journalPriorityLabel(priority),
		Identifier:    identifier,
		PID:           pid,
		Message:       message,
		Truncated:     truncated,
	}
}

func parseLogreadIdentifier(value string) (string, string) {
	text := strings.TrimSuffix(strings.TrimSpace(value), ":")
	if text == "" {
		return "", ""
	}
	if open := strings.LastIndex(text, "["); open > 0 && strings.HasSuffix(text, "]") {
		pid := strings.TrimSuffix(text[open+1:], "]")
		if _, err := strconv.Atoi(pid); err == nil {
			return text[:open], pid
		}
	}
	return text, ""
}

func logreadPriority(facility string) int {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(facility)), ".")
	level := parts[len(parts)-1]
	switch level {
	case "emerg", "alert", "crit", "critical", "err", "error":
		return 3
	case "warn", "warning":
		return 4
	case "notice":
		return 5
	case "info":
		return 6
	case "debug":
		return 7
	default:
		return -1
	}
}

func userMessageForLogreadError(err error, output string) string {
	if err == nil {
		return ""
	}
	if isTimeoutError(err) {
		return logreadTimeoutMessage
	}
	if message := userMessageForLogreadOutput(err.Error() + "\n" + output); message != "" {
		return message
	}
	return "failed to read OpenWrt logread logs."
}

func userMessageForLogreadOutput(output string) string {
	message := strings.ToLower(output)
	switch {
	case strings.Contains(message, logreadMissingSentinel),
		strings.Contains(message, "logread: not found"),
		strings.Contains(message, "logread: command not found"),
		strings.Contains(message, "logread") && strings.Contains(message, "no such file"):
		return logreadUnavailableMessage
	case strings.Contains(message, "permission denied"),
		strings.Contains(message, "access denied"),
		strings.Contains(message, "not permitted"),
		strings.Contains(message, "operation not permitted"):
		return logreadPermissionMessage
	default:
		return ""
	}
}

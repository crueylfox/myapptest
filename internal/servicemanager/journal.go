package servicemanager

import (
	"bufio"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"serverpilot/internal/domain"
)

const maxJournalMessageBytes = 256 * 1024

func parseJournalOutput(serverID int64, unitName string, output string, format string) ([]domain.ServiceJournalLine, bool) {
	_ = serverID
	_ = unitName
	lines := make([]domain.ServiceJournalLine, 0)
	fallback := format != "json"
	scanner := bufio.NewScanner(strings.NewReader(output))
	scanner.Buffer(make([]byte, 0, 64*1024), maxJournalMessageBytes*2)
	var sequence int64
	for scanner.Scan() {
		text := strings.TrimRight(scanner.Text(), "\r")
		if text == "" {
			continue
		}
		sequence++
		line, lineFallback := parseJournalLine(sequence, text, format)
		if lineFallback {
			fallback = true
		}
		lines = append(lines, line)
	}
	if scanner.Err() != nil {
		sequence++
		lines = append(lines, domain.ServiceJournalLine{
			Sequence:      sequence,
			Priority:      -1,
			PriorityLabel: "未知",
			Message:       "日志内容过长，已截断。",
			Truncated:     true,
		})
		fallback = true
	}
	return lines, fallback
}

func parseJournalLine(sequence int64, text string, format string) (domain.ServiceJournalLine, bool) {
	if format != "json" {
		return parseShortJournalLine(sequence, text), true
	}
	var record map[string]any
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.UseNumber()
	if err := decoder.Decode(&record); err != nil {
		return parseShortJournalLine(sequence, text), true
	}
	message, truncated := truncateJournalMessage(journalFieldString(record["MESSAGE"]))
	priority := parseJournalPriorityValue(journalFieldString(record["PRIORITY"]))
	identifier := firstNonEmpty(
		journalFieldString(record["SYSLOG_IDENTIFIER"]),
		journalFieldString(record["_COMM"]),
	)
	return domain.ServiceJournalLine{
		Sequence:      sequence,
		Timestamp:     parseJournalTimestamp(journalFieldString(record["__REALTIME_TIMESTAMP"])),
		Priority:      priority,
		PriorityLabel: journalPriorityLabel(priority),
		Identifier:    identifier,
		PID:           journalFieldString(record["_PID"]),
		Message:       message,
		Truncated:     truncated,
	}, false
}

func parseShortJournalLine(sequence int64, text string) domain.ServiceJournalLine {
	message, truncated := truncateJournalMessage(text)
	return domain.ServiceJournalLine{
		Sequence:      sequence,
		TimestampText: shortJournalTimestampText(text),
		Priority:      -1,
		PriorityLabel: "未知",
		Message:       message,
		Truncated:     truncated,
	}
}

func journalFieldString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case json.Number:
		return typed.String()
	case []any:
		bytes := make([]byte, 0, len(typed))
		for _, item := range typed {
			number, ok := item.(json.Number)
			if !ok {
				return "[二进制日志内容]"
			}
			parsed, err := strconv.ParseUint(number.String(), 10, 8)
			if err != nil {
				return "[二进制日志内容]"
			}
			bytes = append(bytes, byte(parsed))
		}
		if !utf8.Valid(bytes) {
			return "[二进制日志内容]"
		}
		return string(bytes)
	default:
		return fmt.Sprint(typed)
	}
}

func parseJournalTimestamp(value string) string {
	micros, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || micros <= 0 {
		return ""
	}
	seconds := micros / 1_000_000
	nanos := (micros % 1_000_000) * 1000
	return time.Unix(seconds, nanos).UTC().Format(time.RFC3339Nano)
}

func parseJournalPriorityValue(value string) int {
	priority, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return -1
	}
	return priority
}

func journalPriorityLabel(priority int) string {
	switch priority {
	case 0:
		return "紧急"
	case 1:
		return "警报"
	case 2:
		return "严重"
	case 3:
		return "错误"
	case 4:
		return "警告"
	case 5:
		return "注意"
	case 6:
		return "信息"
	case 7:
		return "调试"
	default:
		return "未知"
	}
}

func truncateJournalMessage(value string) (string, bool) {
	if len(value) <= maxJournalMessageBytes {
		return value, false
	}
	cut := maxJournalMessageBytes
	for cut > 0 && !utf8.RuneStart(value[cut]) {
		cut--
	}
	if cut <= 0 {
		return "日志内容过长，已截断。", true
	}
	return value[:cut] + "\n日志内容过长，已截断。", true
}

func shortJournalTimestampText(value string) string {
	text := strings.TrimSpace(value)
	if len(text) < 19 {
		return ""
	}
	if text[0] < '0' || text[0] > '9' {
		return ""
	}
	if index := strings.IndexByte(text, ' '); index > 0 && index+9 <= len(text) {
		return text[:index+9]
	}
	return ""
}

package servicemanager

import (
	"bufio"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"serverpilot/internal/domain"
)

const unitFileSeparator = "---SERVERPILOT-UNIT-FILES---"
const privilegeSeparator = "---SERVERPILOT-PRIVILEGE---"

func parseCapability(serverID int64, output string) domain.ServiceManagerCapability {
	lines := nonEmptyLines(output)
	if len(lines) == 0 || strings.EqualFold(lines[0], "unsupported") {
		return domain.ServiceManagerCapability{
			ServerID:    serverID,
			Available:   false,
			InitSystem:  domain.ServiceManagerInitSystemUnsupported,
			DisplayName: "不支持",
			Error:       serviceManagerUnsupportedMessage,
		}
	}
	version := parseSystemdVersion(lines[0])
	privilege := "none"
	for index, line := range lines {
		if line == privilegeSeparator && index+1 < len(lines) {
			privilege = strings.TrimSpace(lines[index+1])
			break
		}
	}
	capability := domain.ServiceManagerCapability{
		ServerID:                serverID,
		Available:               true,
		InitSystem:              domain.ServiceManagerInitSystemSystemd,
		DisplayName:             systemdDisplayName(version),
		SystemdVersion:          version,
		SupportsJournal:         true,
		SupportsLiveLogs:        true,
		SupportsResourceMetrics: true,
		SupportsStart:           true,
		SupportsStop:            true,
		SupportsRestart:         true,
		SupportsEnable:          true,
		SupportsDisable:         true,
	}
	switch privilege {
	case "root":
		capability.CanManage = true
		capability.RequiresPrivilege = false
	case "sudo":
		capability.CanManage = true
		capability.RequiresPrivilege = true
	default:
		capability.CanManage = false
		capability.RequiresPrivilege = true
		capability.Error = permissionMessage
	}
	return capability
}

func systemdDisplayName(version string) string {
	if strings.TrimSpace(version) == "" {
		return "systemd"
	}
	return "systemd " + strings.TrimSpace(version)
}

func parseSystemdServiceList(serverID int64, output string) []domain.SystemServiceSummary {
	unitsOutput, unitFilesOutput, _ := strings.Cut(output, unitFileSeparator)
	services := make(map[string]domain.SystemServiceSummary)
	for _, line := range nonEmptyLines(unitsOutput) {
		fields := strings.Fields(line)
		if len(fields) > 0 && fields[0] == "●" {
			fields = fields[1:]
		}
		if len(fields) < 4 {
			continue
		}
		unitName := strings.TrimSpace(fields[0])
		if !strings.HasSuffix(unitName, ".service") {
			continue
		}
		description := ""
		if len(fields) > 4 {
			description = strings.Join(fields[4:], " ")
		}
		services[unitName] = domain.SystemServiceSummary{
			ServerID:      serverID,
			UnitName:      unitName,
			DisplayName:   unitName,
			Description:   description,
			LoadState:     fields[1],
			ActiveState:   fields[2],
			SubState:      fields[3],
			UnitFileState: "unknown",
		}
	}
	for _, line := range nonEmptyLines(unitFilesOutput) {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		unitName := strings.TrimSpace(fields[0])
		if !strings.HasSuffix(unitName, ".service") {
			continue
		}
		service := services[unitName]
		if service.UnitName == "" {
			service = domain.SystemServiceSummary{
				ServerID:    serverID,
				UnitName:    unitName,
				DisplayName: unitName,
				LoadState:   "unknown",
				ActiveState: "unknown",
				SubState:    "unknown",
				Description: "",
			}
		}
		service.UnitFileState = fields[1]
		services[unitName] = service
	}
	rows := make([]domain.SystemServiceSummary, 0, len(services))
	for _, service := range services {
		rows = append(rows, decorateSummary(service))
	}
	sort.Slice(rows, func(i, j int) bool {
		return strings.ToLower(rows[i].UnitName) < strings.ToLower(rows[j].UnitName)
	})
	return rows
}

func parseSystemdServiceDetail(serverID int64, unitName string, output string) domain.SystemServiceDetail {
	values := parseKeyValues(output)
	detail := domain.SystemServiceDetail{
		ServerID:      serverID,
		UnitName:      firstNonEmpty(values["Id"], unitName),
		Description:   values["Description"],
		LoadState:     firstNonEmpty(values["LoadState"], "unknown"),
		ActiveState:   firstNonEmpty(values["ActiveState"], "unknown"),
		SubState:      firstNonEmpty(values["SubState"], "unknown"),
		UnitFileState: firstNonEmpty(values["UnitFileState"], "unknown"),
		FragmentPath:  values["FragmentPath"],
		Result:        values["Result"],
		StartedAt:     firstNonEmpty(values["ExecMainStartTimestamp"], values["ActiveEnterTimestamp"]),
		ExitedAt:      firstNonEmpty(values["ExecMainExitTimestamp"], values["ActiveExitTimestamp"]),
	}
	detail.MainPID = parseInt64(values["MainPID"])
	return decorateDetail(detail)
}

func mergeSystemdOptionalDetail(detail domain.SystemServiceDetail, output string) domain.SystemServiceDetail {
	values := parseKeyValues(output)
	detail.MemoryCurrentBytes = parseOptionalInt64(values["MemoryCurrent"])
	detail.CPUUsageNSec = parseOptionalInt64(values["CPUUsageNSec"])
	detail.TasksCurrent = parseOptionalInt64(values["TasksCurrent"])
	detail.RestartCount = parseOptionalInt64(values["NRestarts"])
	if detail.MemoryCurrentBytes == nil &&
		detail.CPUUsageNSec == nil &&
		detail.TasksCurrent == nil &&
		detail.RestartCount == nil {
		return markPartialDetail(detail)
	}
	return detail
}

func parseSystemdFallbackDetail(serverID int64, unitName string, output string) domain.SystemServiceDetail {
	sections := parseFallbackSections(output)
	values := parseKeyValues(sections[fallbackShowSeparator])
	activeState, subState := normalizeIsActiveOutput(sections[fallbackActiveSeparator])
	unitFileState := normalizeIsEnabledOutput(sections[fallbackEnabledSeparator])
	detail := domain.SystemServiceDetail{
		ServerID:      serverID,
		UnitName:      firstNonEmpty(values["Id"], unitName),
		LoadState:     firstNonEmpty(values["LoadState"], "unknown"),
		ActiveState:   activeState,
		SubState:      subState,
		UnitFileState: unitFileState,
		FragmentPath:  values["FragmentPath"],
		Result:        values["Result"],
	}
	detail.MainPID = parseInt64(values["MainPID"])
	return decorateDetail(markPartialDetail(detail))
}

func markPartialDetail(detail domain.SystemServiceDetail) domain.SystemServiceDetail {
	detail.Partial = true
	for _, warning := range detail.Warnings {
		if warning == partialDetailMessage {
			return detail
		}
	}
	detail.Warnings = append(detail.Warnings, partialDetailMessage)
	return detail
}

func parseKeyValues(output string) map[string]string {
	values := make(map[string]string)
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		key, value, ok := strings.Cut(scanner.Text(), "=")
		if !ok {
			continue
		}
		values[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	return values
}

func parseFallbackSections(output string) map[string]string {
	sections := map[string]string{}
	current := ""
	var builder strings.Builder
	flush := func() {
		if current != "" {
			sections[current] = strings.TrimSpace(builder.String())
		}
		builder.Reset()
	}
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		switch line {
		case fallbackActiveSeparator, fallbackEnabledSeparator, fallbackShowSeparator:
			flush()
			current = line
		default:
			if current != "" {
				builder.WriteString(scanner.Text())
				builder.WriteByte('\n')
			}
		}
	}
	flush()
	return sections
}

func normalizeIsActiveOutput(output string) (string, string) {
	switch strings.ToLower(firstFallbackLine(output)) {
	case "active":
		return "active", "running"
	case "inactive":
		return "inactive", "dead"
	case "failed":
		return "failed", "failed"
	case "activating":
		return "activating", "start"
	case "deactivating":
		return "deactivating", "stop"
	case "reloading":
		return "reloading", "reload"
	default:
		return "unknown", "unknown"
	}
}

func normalizeIsEnabledOutput(output string) string {
	state := strings.ToLower(firstFallbackLine(output))
	switch state {
	case "enabled", "enabled-runtime", "disabled", "static", "masked", "masked-runtime", "indirect", "generated", "transient":
		return state
	default:
		return "unknown"
	}
}

func firstFallbackLine(output string) string {
	for _, line := range strings.Split(output, "\n") {
		text := strings.TrimSpace(line)
		if text != "" {
			return text
		}
	}
	return ""
}

func parseSystemdVersion(line string) string {
	fields := strings.Fields(strings.TrimSpace(line))
	if len(fields) >= 2 && strings.EqualFold(fields[0], "systemd") {
		return fields[1]
	}
	return strings.TrimSpace(line)
}

func parseInt64(value string) int64 {
	parsed, _ := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	return parsed
}

func parseOptionalInt64(value string) *int64 {
	text := strings.TrimSpace(value)
	if text == "" || text == "[not set]" || text == "n/a" {
		return nil
	}
	parsed, err := strconv.ParseUint(text, 10, 64)
	if err != nil || parsed > math.MaxInt64 {
		return nil
	}
	value64 := int64(parsed)
	return &value64
}

func nonEmptyLines(output string) []string {
	scanner := bufio.NewScanner(strings.NewReader(output))
	lines := []string{}
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func timestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

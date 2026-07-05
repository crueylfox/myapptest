package processmanager

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"serverpilot/internal/domain"
)

const (
	defaultProcessLimit = 500
	maxProcessLimit     = 2000
	processStrategyMark = "__SERVERPILOT_PROCESS_STRATEGY__"
)

type processListStrategy struct {
	name string
	body string
}

func parseProcessList(serverID int64, output string) (domain.ProcessListResponse, error) {
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return domain.ProcessListResponse{}, errors.New("进程列表为空")
	}
	strategies := splitProcessListStrategies(trimmed)
	var lastErr error
	var failed []string
	for _, strategy := range strategies {
		response, err := parseSingleProcessList(serverID, strategy.name, strategy.body)
		if err != nil {
			lastErr = err
			if strategy.name != "" {
				failed = append(failed, strategy.name)
			}
			continue
		}
		if response.Processes == nil {
			response.Processes = []domain.ProcessEntry{}
		}
		if response.Warnings == nil {
			response.Warnings = []string{}
		}
		return response, nil
	}
	if lastErr != nil {
		if len(failed) > 0 {
			return domain.ProcessListResponse{}, fmt.Errorf("进程列表解析失败(%s): %w", strings.Join(failed, ","), lastErr)
		}
		return domain.ProcessListResponse{}, lastErr
	}
	return domain.ProcessListResponse{}, errors.New("未读取到进程数据")
}

func splitProcessListStrategies(input string) []processListStrategy {
	lines := strings.Split(input, "\n")
	var strategies []processListStrategy
	current := processListStrategy{name: "legacy"}
	var body []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, processStrategyMark) {
			if len(body) > 0 || current.name != "legacy" {
				current.body = strings.Join(body, "\n")
				strategies = append(strategies, current)
			}
			current = processListStrategy{name: strings.TrimSpace(strings.TrimPrefix(trimmed, processStrategyMark))}
			body = body[:0]
			continue
		}
		body = append(body, line)
	}
	current.body = strings.Join(body, "\n")
	if len(body) > 0 || len(strategies) == 0 {
		strategies = append(strategies, current)
	}
	return strategies
}

func parseSingleProcessList(serverID int64, strategy string, output string) (domain.ProcessListResponse, error) {
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return domain.ProcessListResponse{}, errors.New("进程列表为空")
	}
	mode := ""
	body := trimmed
	if first, rest, ok := strings.Cut(trimmed, "\n"); ok && strings.HasPrefix(first, "mode=") {
		mode = strings.TrimSpace(strings.TrimPrefix(first, "mode="))
		body = rest
	} else if strings.HasPrefix(trimmed, "mode=") {
		mode = strings.TrimSpace(strings.TrimPrefix(trimmed, "mode="))
		body = ""
	}
	var processes []domain.ProcessEntry
	var warnings []string
	var err error
	switch mode {
	case "proc":
		processes, warnings, err = ParseProcProcessList(serverID, body)
	case "ps", "":
		processes, warnings, err = ParseGNUPS(serverID, body)
	case "ps_aux":
		processes, warnings, err = ParsePSAux(serverID, body)
	case "busybox":
		processes, warnings, err = ParseBusyBoxPS(serverID, body)
	default:
		return domain.ProcessListResponse{}, fmt.Errorf("未知进程列表格式: %s", mode)
	}
	if err != nil {
		return domain.ProcessListResponse{}, err
	}
	return domain.ProcessListResponse{
		ServerID:       serverID,
		Processes:      processes,
		Warnings:       warnings,
		ParserStrategy: firstNonEmpty(strategy, mode),
		Timestamp:      timestamp(),
	}, nil
}

// ParseProcProcessList parses ServerPilot's tab-separated /proc collector
// output. The final column intentionally carries only UI data; callers must not
// log it.
func ParseProcProcessList(serverID int64, input string) ([]domain.ProcessEntry, []string, error) {
	processes := make([]domain.ProcessEntry, 0)
	var warnings []string
	for _, raw := range strings.Split(strings.TrimSpace(input), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "warning\t") {
			warnings = append(warnings, strings.TrimSpace(strings.TrimPrefix(line, "warning\t")))
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) < 12 {
			continue
		}
		process, ok := entryFromFields(serverID, fields)
		if ok {
			processes = append(processes, process)
		}
	}
	if len(processes) == 0 {
		return processes, warnings, errors.New("未读取到进程数据")
	}
	return processes, warnings, nil
}

// ParseGNUPS parses ps -eo pid,ppid,user,stat,pcpu,pmem,rss,vsz,etime,comm,args
// output. It accepts both header and headerless formats.
func ParseGNUPS(serverID int64, input string) ([]domain.ProcessEntry, []string, error) {
	processes := make([]domain.ProcessEntry, 0)
	for _, raw := range strings.Split(strings.TrimSpace(input), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 10 || !isInteger(fields[0]) {
			continue
		}
		pid, _ := strconv.ParseInt(fields[0], 10, 64)
		ppid, _ := strconv.ParseInt(fields[1], 10, 64)
		rssKB := parseUint(fields[6])
		vszKB := parseUint(fields[7])
		command := fields[9]
		args := ""
		if len(fields) > 10 {
			args = strings.Join(fields[10:], " ")
		}
		if args == "" {
			args = command
		}
		state := fields[3]
		process := domain.ProcessEntry{
			ServerID:         serverID,
			PID:              pid,
			PPID:             ppid,
			User:             fields[2],
			State:            state,
			StateLabel:       stateLabel(state),
			CPUPercent:       parseFloat(fields[4]),
			MemoryPercent:    parseFloat(fields[5]),
			RSSBytes:         rssKB * 1024,
			VSZBytes:         vszKB * 1024,
			Command:          sanitizeProcessText(command, 120),
			ArgsPreview:      sanitizeProcessText(args, 240),
			StartedOrElapsed: fields[8],
		}
		process.IsKernelThread = isKernelLike(process.Command, process.ArgsPreview)
		process.CanSignal = canSignal(process)
		processes = append(processes, process)
	}
	if len(processes) == 0 {
		return processes, nil, errors.New("未读取到 ps 进程数据")
	}
	return processes, nil, nil
}

// ParsePSAux parses the widely available ps aux/auxww format:
// USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND.
func ParsePSAux(serverID int64, input string) ([]domain.ProcessEntry, []string, error) {
	processes := make([]domain.ProcessEntry, 0)
	for _, raw := range strings.Split(strings.TrimSpace(input), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 11 || !isInteger(fields[1]) {
			continue
		}
		pid, _ := strconv.ParseInt(fields[1], 10, 64)
		args := strings.Join(fields[10:], " ")
		command := commandName(args)
		state := fields[7]
		process := domain.ProcessEntry{
			ServerID:         serverID,
			PID:              pid,
			User:             fields[0],
			State:            state,
			StateLabel:       stateLabel(state),
			CPUPercent:       parseFloat(fields[2]),
			MemoryPercent:    parseFloat(fields[3]),
			RSSBytes:         parseUint(fields[5]) * 1024,
			VSZBytes:         parseUint(fields[4]) * 1024,
			Command:          sanitizeProcessText(command, 120),
			ArgsPreview:      sanitizeProcessText(args, 240),
			StartedOrElapsed: fields[8],
		}
		process.IsKernelThread = isKernelLike(process.Command, process.ArgsPreview)
		process.CanSignal = canSignal(process)
		processes = append(processes, process)
	}
	if len(processes) == 0 {
		return processes, nil, errors.New("未读取到 ps aux 进程数据")
	}
	return processes, nil, nil
}

// ParseBusyBoxPS parses common BusyBox/Toybox ps w output. These variants often
// omit CPU/memory columns, so resource fields stay zero.
func ParseBusyBoxPS(serverID int64, input string) ([]domain.ProcessEntry, []string, error) {
	processes := make([]domain.ProcessEntry, 0)
	for _, raw := range strings.Split(strings.TrimSpace(input), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 || !isInteger(fields[0]) {
			continue
		}
		pid, _ := strconv.ParseInt(fields[0], 10, 64)
		user := fields[1]
		state := ""
		commandStart := 2
		if len(fields) > 3 && looksLikeState(fields[2]) {
			state = fields[2]
			commandStart = 3
		} else if len(fields) > 4 && isNumeric(fields[2]) && looksLikeState(fields[3]) {
			state = fields[3]
			commandStart = 4
		} else if len(fields) > 3 && looksLikeDuration(fields[2]) {
			commandStart = 3
		}
		args := strings.Join(fields[commandStart:], " ")
		command := commandName(args)
		process := domain.ProcessEntry{
			ServerID:    serverID,
			PID:         pid,
			User:        user,
			State:       state,
			StateLabel:  stateLabel(state),
			Command:     sanitizeProcessText(command, 120),
			ArgsPreview: sanitizeProcessText(args, 240),
		}
		process.IsKernelThread = isKernelLike(process.Command, process.ArgsPreview)
		process.CanSignal = canSignal(process)
		processes = append(processes, process)
	}
	if len(processes) == 0 {
		return processes, nil, errors.New("未读取到 BusyBox 进程数据")
	}
	return processes, []string{"当前系统只提供简化 ps 输出，部分字段不可用。"}, nil
}

func filterSortLimitProcesses(
	processes []domain.ProcessEntry,
	query string,
	sortBy domain.ProcessSortBy,
	sortDir domain.ProcessSortDir,
	limit int,
) []domain.ProcessEntry {
	query = strings.ToLower(strings.TrimSpace(query))
	filtered := make([]domain.ProcessEntry, 0, len(processes))
	for _, process := range processes {
		if query != "" && !strings.Contains(strconv.FormatInt(process.PID, 10), query) &&
			!strings.Contains(strings.ToLower(process.User), query) &&
			!strings.Contains(strings.ToLower(process.Command), query) &&
			!strings.Contains(strings.ToLower(process.ArgsPreview), query) {
			continue
		}
		filtered = append(filtered, process)
	}
	if sortBy == "" {
		sortBy = domain.ProcessSortCPU
	}
	desc := sortDir != domain.ProcessSortAsc
	sort.SliceStable(filtered, func(i, j int) bool {
		a, b := filtered[i], filtered[j]
		less := false
		switch sortBy {
		case domain.ProcessSortMemory:
			less = sortableFloat(a.MemoryPercent) < sortableFloat(b.MemoryPercent)
		case domain.ProcessSortPID:
			less = a.PID < b.PID
		case domain.ProcessSortUser:
			less = strings.ToLower(a.User) < strings.ToLower(b.User)
		case domain.ProcessSortCommand:
			less = strings.ToLower(a.Command) < strings.ToLower(b.Command)
		default:
			less = sortableFloat(a.CPUPercent) < sortableFloat(b.CPUPercent)
		}
		if desc {
			return !less && !equalForSort(sortBy, a, b)
		}
		return less
	})
	if limit <= 0 {
		limit = defaultProcessLimit
	}
	if limit > maxProcessLimit {
		limit = maxProcessLimit
	}
	if len(filtered) > limit {
		return filtered[:limit]
	}
	return filtered
}

func entryFromFields(serverID int64, fields []string) (domain.ProcessEntry, bool) {
	pid, err := strconv.ParseInt(fields[0], 10, 64)
	if err != nil || pid <= 0 {
		return domain.ProcessEntry{}, false
	}
	ppid, _ := strconv.ParseInt(fields[1], 10, 64)
	rss := parseUint(fields[6])
	vsz := parseUint(fields[7])
	kernel := fields[11] == "1"
	process := domain.ProcessEntry{
		ServerID:         serverID,
		PID:              pid,
		PPID:             ppid,
		User:             fields[2],
		State:            fields[3],
		StateLabel:       stateLabel(fields[3]),
		CPUPercent:       parseFloat(fields[4]),
		MemoryPercent:    parseFloat(fields[5]),
		RSSBytes:         rss,
		VSZBytes:         vsz,
		StartedOrElapsed: fields[8],
		Command:          sanitizeProcessText(fields[9], 120),
		ArgsPreview:      sanitizeProcessText(fields[10], 240),
		IsKernelThread:   kernel,
	}
	if process.Command == "" {
		process.Command = commandName(process.ArgsPreview)
	}
	process.IsKernelThread = process.IsKernelThread || isKernelLike(process.Command, process.ArgsPreview)
	process.CanSignal = canSignal(process)
	return process, true
}

func parseDetailKV(output string) map[string]string {
	result := make(map[string]string)
	for _, raw := range strings.Split(strings.TrimSpace(output), "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(raw), "=")
		if !ok {
			continue
		}
		result[key] = value
	}
	return result
}

func detailFromEntry(entry domain.ProcessEntry, values map[string]string, all []domain.ProcessEntry) (domain.ProcessDetail, error) {
	if values["error"] == "not_found" {
		return domain.ProcessDetail{}, errors.New("进程已退出")
	}
	detail := domain.ProcessDetail{
		ServerID:            entry.ServerID,
		PID:                 entry.PID,
		PPID:                entry.PPID,
		User:                entry.User,
		State:               entry.State,
		StateLabel:          entry.StateLabel,
		Command:             entry.Command,
		Cmdline:             firstNonEmpty(values["cmdline"], entry.ArgsPreview),
		RSSBytes:            entry.RSSBytes,
		VSZBytes:            entry.VSZBytes,
		MemoryPercent:       entry.MemoryPercent,
		CPUPercent:          entry.CPUPercent,
		EnvironmentRedacted: true,
		LastUpdatedAt:       timestamp(),
		IsKernelThread:      entry.IsKernelThread,
		CanSignal:           entry.CanSignal,
	}
	detail.Cwd = values["cwd"]
	detail.Exe = values["exe"]
	if threads := parseOptionalInt(values["threads"]); threads != nil {
		detail.Threads = threads
	}
	if openFiles := parseOptionalInt(values["openFilesCount"]); openFiles != nil {
		detail.OpenFilesCount = openFiles
	}
	for _, process := range all {
		if process.PID == entry.PPID {
			copy := process
			detail.Parent = &copy
		}
		if process.PPID == entry.PID {
			detail.Children = append(detail.Children, process)
		}
	}
	if detail.Cmdline == "" {
		detail.Warnings = append(detail.Warnings, "命令行不可读取或为空。")
	}
	return detail, nil
}

func stateLabel(state string) string {
	if state == "" {
		return "未知"
	}
	switch state[:1] {
	case "R":
		return "运行"
	case "S":
		return "睡眠"
	case "D":
		return "不可中断睡眠"
	case "T", "t":
		return "已停止"
	case "Z":
		return "僵尸"
	case "I":
		return "空闲"
	default:
		return state
	}
}

func canSignal(process domain.ProcessEntry) bool {
	return process.PID > 1 && !process.IsKernelThread
}

func isKernelLike(command string, args string) bool {
	text := strings.TrimSpace(firstNonEmpty(args, command))
	return strings.HasPrefix(text, "[") && strings.HasSuffix(text, "]")
}

func commandName(args string) string {
	args = strings.TrimSpace(args)
	if args == "" {
		return ""
	}
	if strings.HasPrefix(args, "[") && strings.HasSuffix(args, "]") {
		return strings.TrimSpace(strings.Trim(args, "[]"))
	}
	first := strings.Fields(args)[0]
	first = strings.Trim(first, `"`)
	if index := strings.LastIndex(first, "/"); index >= 0 && index < len(first)-1 {
		return first[index+1:]
	}
	return first
}

func looksLikeState(value string) bool {
	if value == "" {
		return false
	}
	switch value[0] {
	case 'R', 'S', 'D', 'T', 't', 'Z', 'I':
		return true
	default:
		return false
	}
}

func looksLikeDuration(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if (r < '0' || r > '9') && r != ':' && r != '-' {
			return false
		}
	}
	return strings.Contains(value, ":")
}

func isInteger(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func isNumeric(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range strings.TrimSpace(value) {
		if (r < '0' || r > '9') && r != '.' && r != '-' {
			return false
		}
	}
	return true
}

func parseFloat(value string) float64 {
	normalized := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(value), "%"))
	if normalized == "" {
		return 0
	}
	parsed, err := strconv.ParseFloat(normalized, 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return 0
	}
	return parsed
}

func parseUint(value string) uint64 {
	parsed, _ := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
	return parsed
}

func parseOptionalInt(value string) *int {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return nil
	}
	return &parsed
}

func sanitizeProcessText(value string, maxLen int) string {
	value = strings.ReplaceAll(value, "\x00", " ")
	value = strings.ReplaceAll(value, "\t", " ")
	value = strings.ReplaceAll(value, "\r", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	value = strings.Join(strings.Fields(value), " ")
	if maxLen > 0 && len(value) > maxLen {
		return value[:maxLen] + "..."
	}
	return value
}

func equalForSort(sortBy domain.ProcessSortBy, a, b domain.ProcessEntry) bool {
	switch sortBy {
	case domain.ProcessSortMemory:
		return sortableFloat(a.MemoryPercent) == sortableFloat(b.MemoryPercent)
	case domain.ProcessSortPID:
		return a.PID == b.PID
	case domain.ProcessSortUser:
		return strings.EqualFold(a.User, b.User)
	case domain.ProcessSortCommand:
		return strings.EqualFold(a.Command, b.Command)
	default:
		return sortableFloat(a.CPUPercent) == sortableFloat(b.CPUPercent)
	}
}

func sortableFloat(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func timestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

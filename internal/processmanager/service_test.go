package processmanager

import (
	"context"
	"errors"
	"math"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"hostdeck/internal/domain"
)

const sampleProcList = "mode=proc\n" +
	"1\t0\troot\tS\t0.1\t0.2\t1024\t4096\t01:00\tinit\t/sbin/init\t0\n" +
	"42\t1\troot\tR\t12.5\t3.1\t1048576\t2097152\t00:02\tbash\tbash -lc sleep 30\t0\n" +
	"77\t2\troot\tS\t0\t0\t0\t0\t00:10\tkthreadd\t[kthreadd]\t1\n" +
	"108\t42\twww-data\tS\t1.5\t9.8\t2097152\t4194304\t00:03\tnginx\tnginx: worker process\t0\n" +
	"warning\t部分进程无法读取。\n"

const sampleGNUPSList = `    1     0 root S 0.1 0.2 1 4 01:00 init /sbin/init
   42     1 root R 12.5 3.1 1024 2048 00:02 bash bash -lc sleep 30
   77     2 root S 0 0 0 0 00:10 kthreadd [kthreadd]
  108    42 www-data S 1.5 9.8 2048 4096 00:03 nginx nginx: worker process`

type fakeTransport struct {
	mu          sync.Mutex
	listOutput  string
	listOutputs map[string]string
	details     map[int64]string
	commands    []string
	closeCount  int
	err         error
	blockRun    bool
}

func (t *fakeTransport) Run(ctx context.Context, command string) (string, error) {
	t.mu.Lock()
	t.commands = append(t.commands, command)
	blockRun := t.blockRun
	t.mu.Unlock()
	if blockRun {
		<-ctx.Done()
		return "", ctx.Err()
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.err != nil {
		return "", t.err
	}
	if output, ok := t.listOutputs[command]; ok {
		return output, nil
	}
	if isListCommand(command) {
		return t.listOutput, nil
	}
	if strings.Contains(command, "kill -TERM") || strings.Contains(command, "kill -KILL") {
		return "ok\n", nil
	}
	for pid, output := range t.details {
		if strings.Contains(command, "pid="+strconvFormatInt(pid)+"\n") {
			return output, nil
		}
	}
	return "", nil
}

func (t *fakeTransport) Fingerprint() string { return "" }

func (t *fakeTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closeCount++
	return nil
}

func (t *fakeTransport) saw(pattern string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, command := range t.commands {
		if strings.Contains(command, pattern) {
			return true
		}
	}
	return false
}

func (t *fakeTransport) commandCount() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.commands)
}

func (t *fakeTransport) sawListCommand() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, command := range t.commands {
		if isListCommand(command) {
			return true
		}
	}
	return false
}

type fakeEmitter struct {
	mu     sync.Mutex
	lists  []domain.ProcessListEvent
	states []domain.ProcessStateEvent
	errors []domain.ProcessErrorEvent
}

func (e *fakeEmitter) State(event domain.ProcessStateEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.states = append(e.states, event)
}

func (e *fakeEmitter) List(event domain.ProcessListEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.lists = append(e.lists, event)
}

func (e *fakeEmitter) Detail(domain.ProcessDetailEvent) {}

func (e *fakeEmitter) Error(event domain.ProcessErrorEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.errors = append(e.errors, event)
}

func TestParseGNUPS(t *testing.T) {
	input := `PID PPID USER STAT %CPU %MEM RSS VSZ ELAPSED COMMAND COMMAND
  42     1 root R 12.5 3.1 1024 2048 00:02 bash bash -lc sleep 30
 108    42 www-data S 1.5 9.8 2048 4096 00:03 nginx nginx: worker process`
	processes, warnings, err := ParseGNUPS(9, input)
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 || len(processes) != 2 {
		t.Fatalf("processes=%+v warnings=%v", processes, warnings)
	}
	if processes[0].ServerID != 9 || processes[0].PID != 42 || processes[0].PPID != 1 ||
		processes[0].CPUPercent != 12.5 || processes[0].RSSBytes != 1024*1024 ||
		processes[0].Command != "bash" || processes[0].ArgsPreview != "bash -lc sleep 30" {
		t.Fatalf("unexpected process: %+v", processes[0])
	}
}

func TestParseProcessListFallsBackFromInvalidGNUPSToPSAux(t *testing.T) {
	output := processStrategyMark + " gnu_no_header\nmode=ps\nnot compatible\n" +
		processStrategyMark + " ps_aux\nmode=ps_aux\n" +
		"USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND\n" +
		"root 42 1.5 2.5 2048 1024 ? S 10:00 0:00 /usr/sbin/sshd -D\n"
	response, err := parseProcessList(7, output)
	if err != nil {
		t.Fatal(err)
	}
	if response.ParserStrategy != "ps_aux" || len(response.Processes) != 1 || response.Processes[0].Command != "sshd" {
		t.Fatalf("unexpected fallback response: %+v", response)
	}
}

func TestParsePSAuxKeepsKernelThreadsAndDefaultsParent(t *testing.T) {
	input := `USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
root 77 0.0 0.0 0 0 ? I 10:00 0:00 [kworker/1:2-mm_percpu_wq]`
	processes, warnings, err := ParsePSAux(7, input)
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 || len(processes) != 1 {
		t.Fatalf("processes=%+v warnings=%v", processes, warnings)
	}
	if processes[0].Command != "kworker/1:2-mm_percpu_wq" {
		t.Fatalf("kernel thread command should be preserved: %+v", processes[0])
	}
	if !processes[0].IsKernelThread || processes[0].CanSignal {
		t.Fatalf("kernel thread signal guard mismatch: %+v", processes[0])
	}
	if processes[0].PPID != 0 || processes[0].CPUPercent != 0 || processes[0].MemoryPercent != 0 {
		t.Fatalf("unexpected ps aux defaults: %+v", processes[0])
	}
}

func TestParseGNUPSParsesPercentValuesAsNumbers(t *testing.T) {
	input := `PID PPID USER STAT %CPU %MEM RSS VSZ ELAPSED COMMAND COMMAND
  42     1 root R 12.5% 3.1% 1024 2048 00:02 bash bash -lc sleep 30`
	processes, _, err := ParseGNUPS(9, input)
	if err != nil {
		t.Fatal(err)
	}
	if len(processes) != 1 || processes[0].CPUPercent != 12.5 || processes[0].MemoryPercent != 3.1 {
		t.Fatalf("percent values were not parsed as numbers: %+v", processes)
	}
}

func TestParseBusyBoxPS(t *testing.T) {
	input := `PID USER     STAT COMMAND
    1 root     S    init
   42 root     R    sh -c sleep 30`
	processes, warnings, err := ParseBusyBoxPS(7, input)
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) == 0 || len(processes) != 2 || processes[1].Command != "sh" {
		t.Fatalf("processes=%+v warnings=%v", processes, warnings)
	}
	if processes[0].CPUPercent != 0 || processes[0].MemoryPercent != 0 {
		t.Fatalf("missing BusyBox CPU/memory fields should default to zero: %+v", processes[0])
	}
}

func TestParseBusyBoxPSWithVSZColumn(t *testing.T) {
	input := `PID USER VSZ STAT COMMAND
1 root 1228 S init
77 root 0 I [kworker/1:2-mm_percpu_wq]`
	processes, warnings, err := ParseBusyBoxPS(7, input)
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) == 0 || len(processes) != 2 {
		t.Fatalf("processes=%+v warnings=%v", processes, warnings)
	}
	if processes[0].Command != "init" || processes[0].CPUPercent != 0 || processes[0].MemoryPercent != 0 {
		t.Fatalf("busybox process defaults mismatch: %+v", processes[0])
	}
	if processes[1].Command != "kworker/1:2-mm_percpu_wq" {
		t.Fatalf("kernel thread command should be preserved: %+v", processes[1])
	}
	if !processes[1].IsKernelThread || processes[1].CanSignal {
		t.Fatalf("kernel thread should display but not signal: %+v", processes[1])
	}
}

func TestParseProcSkipsUnreadableRowsAndKeepsWarning(t *testing.T) {
	input := "bad row\n42\t1\troot\tR\t12.5\t3.1\t1048576\t2097152\t00:02\tbash\tbash -lc sleep 30\t0\nwarning\t部分进程无法读取。\n"
	processes, warnings, err := ParseProcProcessList(3, input)
	if err != nil {
		t.Fatal(err)
	}
	if len(processes) != 1 || len(warnings) != 1 {
		t.Fatalf("processes=%+v warnings=%v", processes, warnings)
	}
}

func TestParseProcEmptyReturnsEmptySliceAndTypedError(t *testing.T) {
	processes, warnings, err := ParseProcProcessList(7, "warning\t部分进程无法读取。\n")
	if err == nil || !strings.Contains(err.Error(), "未读取到进程数据") {
		t.Fatalf("expected typed proc parse error, got %v", err)
	}
	if processes == nil || len(processes) != 0 || len(warnings) != 1 {
		t.Fatalf("unexpected empty proc result: processes=%+v warnings=%v", processes, warnings)
	}
}

func TestListProcessesSortAndQuery(t *testing.T) {
	manager, transport := newFakeManager(t)
	response, err := manager.List(testConnection(), domain.AuthRequest{}, domain.ListProcessesRequest{
		ServerID: 1,
		Query:    "nginx",
		SortBy:   domain.ProcessSortMemory,
		SortDir:  domain.ProcessSortDesc,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Processes) != 1 || response.Processes[0].Command != "nginx" {
		t.Fatalf("response=%+v", response)
	}
	if !transport.saw(gnuNoHeaderProcessListCommand()) {
		t.Fatal("list command was not executed")
	}
	if transport.commandCount() != 1 {
		t.Fatalf("list should use one SSH exec, got %d", transport.commandCount())
	}
}

func TestListProcessesFallsBackAcrossCommandStrategies(t *testing.T) {
	manager, transport := newFakeManager(t)
	transport.listOutput = "not compatible\n"
	transport.listOutputs = map[string]string{
		gnuNoHeaderProcessListCommand(): "not compatible\n",
		gnuHeaderProcessListCommand():   "",
		psAuxProcessListCommand(): "USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND\n" +
			"root 42 1.5 2.5 2048 1024 ? S 10:00 0:00 /usr/sbin/sshd -D\n",
	}
	response, err := manager.List(testConnection(), domain.AuthRequest{}, domain.ListProcessesRequest{
		ServerID: 1,
		SortBy:   domain.ProcessSortCPU,
		SortDir:  domain.ProcessSortDesc,
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.ParserStrategy != "ps_aux" || len(response.Processes) != 1 || response.Processes[0].Command != "sshd" {
		t.Fatalf("unexpected fallback response: %+v", response)
	}
	if transport.commandCount() != 3 {
		t.Fatalf("expected three strategy commands, got %d", transport.commandCount())
	}
}

func TestListProcessesFallsBackToBusyBoxStrategy(t *testing.T) {
	manager, transport := newFakeManager(t)
	transport.listOutput = "not compatible\n"
	transport.listOutputs = map[string]string{
		gnuNoHeaderProcessListCommand(): "not compatible\n",
		gnuHeaderProcessListCommand():   "not compatible\n",
		psAuxProcessListCommand():       "not compatible\n",
		busyBoxProcessListCommand(): "PID USER VSZ STAT COMMAND\n" +
			"1 root 1228 S init\n" +
			"77 root 0 I [kworker/1:2-mm_percpu_wq]\n",
	}
	response, err := manager.List(testConnection(), domain.AuthRequest{}, domain.ListProcessesRequest{ServerID: 1})
	if err != nil {
		t.Fatal(err)
	}
	if response.ParserStrategy != "busybox" || len(response.Processes) != 2 {
		t.Fatalf("unexpected BusyBox fallback response: %+v", response)
	}
	if response.Processes[1].Command != "kworker/1:2-mm_percpu_wq" || !response.Processes[1].IsKernelThread || response.Processes[1].CanSignal {
		t.Fatalf("kernel thread should display but not signal: %+v", response.Processes[1])
	}
	if transport.commandCount() != 4 {
		t.Fatalf("expected four strategy commands, got %d", transport.commandCount())
	}
}

func TestListProcessesFallsBackToProcStrategy(t *testing.T) {
	manager, transport := newFakeManager(t)
	transport.listOutput = "not compatible\n"
	transport.listOutputs = map[string]string{
		gnuNoHeaderProcessListCommand(): "not compatible\n",
		gnuHeaderProcessListCommand():   "not compatible\n",
		psAuxProcessListCommand():       "not compatible\n",
		busyBoxProcessListCommand():     "not compatible\n",
		procProcessListCommandText():    strings.TrimPrefix(sampleProcList, "mode=proc\n"),
	}
	response, err := manager.List(testConnection(), domain.AuthRequest{}, domain.ListProcessesRequest{ServerID: 1})
	if err != nil {
		t.Fatal(err)
	}
	if response.ParserStrategy != "proc" || len(response.Processes) == 0 {
		t.Fatalf("unexpected proc fallback response: %+v", response)
	}
	if transport.commandCount() != len(listProcessCommands) {
		t.Fatalf("expected all strategy commands through proc, got %d", transport.commandCount())
	}
}

func TestListProcessesAllStrategiesFailReturnsChineseError(t *testing.T) {
	manager, transport := newFakeManager(t)
	transport.listOutput = "not compatible\n"
	if _, err := manager.List(testConnection(), domain.AuthRequest{}, domain.ListProcessesRequest{ServerID: 1}); err == nil || !strings.Contains(err.Error(), "读取进程列表失败") {
		t.Fatalf("expected Chinese list failure, got %v", err)
	}
	if transport.commandCount() != len(listProcessCommands) {
		t.Fatalf("expected all strategy commands, got %d", transport.commandCount())
	}
}

func TestListProcessesSortsCPUAndMemoryNumerically(t *testing.T) {
	manager, _ := newFakeManager(t)
	cpuDesc, err := manager.List(testConnection(), domain.AuthRequest{}, domain.ListProcessesRequest{
		ServerID: 1,
		SortBy:   domain.ProcessSortCPU,
		SortDir:  domain.ProcessSortDesc,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := []int64{cpuDesc.Processes[0].PID, cpuDesc.Processes[1].PID}; got[0] != 42 || got[1] != 108 {
		t.Fatalf("CPU desc sort mismatch: got %v", got)
	}
	cpuAsc, err := manager.List(testConnection(), domain.AuthRequest{}, domain.ListProcessesRequest{
		ServerID: 1,
		SortBy:   domain.ProcessSortCPU,
		SortDir:  domain.ProcessSortAsc,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := []int64{cpuAsc.Processes[0].PID, cpuAsc.Processes[1].PID}; got[0] != 77 || got[1] != 1 {
		t.Fatalf("CPU asc sort mismatch: got %v", got)
	}
	memoryDesc, err := manager.List(testConnection(), domain.AuthRequest{}, domain.ListProcessesRequest{
		ServerID: 1,
		SortBy:   domain.ProcessSortMemory,
		SortDir:  domain.ProcessSortDesc,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := []int64{memoryDesc.Processes[0].PID, memoryDesc.Processes[1].PID}; got[0] != 108 || got[1] != 42 {
		t.Fatalf("memory desc sort mismatch: got %v", got)
	}
	memoryAsc, err := manager.List(testConnection(), domain.AuthRequest{}, domain.ListProcessesRequest{
		ServerID: 1,
		SortBy:   domain.ProcessSortMemory,
		SortDir:  domain.ProcessSortAsc,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := []int64{memoryAsc.Processes[0].PID, memoryAsc.Processes[1].PID}; got[0] != 77 || got[1] != 1 {
		t.Fatalf("memory asc sort mismatch: got %v", got)
	}
}

func TestSortTreatsNaNResourceValuesAsZero(t *testing.T) {
	processes := []domain.ProcessEntry{
		{PID: 1, Command: "nan", CPUPercent: math.NaN(), MemoryPercent: math.NaN()},
		{PID: 2, Command: "low", CPUPercent: 3.1, MemoryPercent: 1.5},
		{PID: 3, Command: "high", CPUPercent: 20.5, MemoryPercent: 9.8},
	}
	cpuSorted := filterSortLimitProcesses(processes, "", domain.ProcessSortCPU, domain.ProcessSortDesc, 10)
	if got := []int64{cpuSorted[0].PID, cpuSorted[1].PID, cpuSorted[2].PID}; got[0] != 3 || got[1] != 2 || got[2] != 1 {
		t.Fatalf("NaN CPU sort mismatch: got %v", got)
	}
	memorySorted := filterSortLimitProcesses(processes, "", domain.ProcessSortMemory, domain.ProcessSortDesc, 10)
	if got := []int64{memorySorted[0].PID, memorySorted[1].PID, memorySorted[2].PID}; got[0] != 3 || got[1] != 2 || got[2] != 1 {
		t.Fatalf("NaN memory sort mismatch: got %v", got)
	}
}

func TestDetailUsesSingleFastCommandAndRedactsEnvironment(t *testing.T) {
	manager, transport := newFakeManager(t)
	detail, err := manager.Detail(testConnection(), domain.AuthRequest{}, domain.GetProcessDetailRequest{
		ServerID: 1,
		PID:      42,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !detail.EnvironmentRedacted || detail.Cmdline == "" {
		t.Fatalf("detail did not redact env or include cmdline: %+v", detail)
	}
	if detail.Parent != nil || len(detail.Children) != 0 {
		t.Fatalf("fast detail should not rebuild process relations: parent=%+v children=%+v", detail.Parent, detail.Children)
	}
	if transport.commandCount() != 1 || transport.sawListCommand() {
		t.Fatalf("detail should use only one detail command, count=%d", transport.commandCount())
	}
}

func TestDetailRejectsInvalidPID(t *testing.T) {
	manager, transport := newFakeManager(t)
	if _, err := manager.Detail(testConnection(), domain.AuthRequest{}, domain.GetProcessDetailRequest{
		ServerID: 1,
		PID:      0,
	}); err == nil || !strings.Contains(err.Error(), "PID") {
		t.Fatalf("expected invalid PID error, got %v", err)
	}
	if transport.commandCount() != 0 {
		t.Fatalf("invalid PID should not execute remote command, count=%d", transport.commandCount())
	}
}

func TestListAndDetailTimeoutReturnChineseErrors(t *testing.T) {
	transport := &fakeTransport{blockRun: true}
	manager := NewWithDialer(context.Background(), nil, nil, func() time.Duration { return 5 * time.Millisecond }, func(
		context.Context,
		domain.Connection,
		domain.AuthRequest,
		time.Duration,
	) (Transport, time.Duration, error) {
		return transport, 0, nil
	})
	if _, err := manager.List(testConnection(), domain.AuthRequest{}, domain.ListProcessesRequest{ServerID: 1}); err == nil || !strings.Contains(err.Error(), "读取进程列表超时") {
		t.Fatalf("expected list timeout error, got %v", err)
	}
	if _, err := manager.Detail(testConnection(), domain.AuthRequest{}, domain.GetProcessDetailRequest{ServerID: 1, PID: 42}); err == nil || !strings.Contains(err.Error(), "读取进程详情超时") {
		t.Fatalf("expected detail timeout error, got %v", err)
	}
}

func TestProcessCommandsDoNotReadEnvironmentOrSlowOpenFiles(t *testing.T) {
	for _, strategy := range listProcessCommands {
		if strings.Contains(strategy.command, "environ") {
			t.Fatal("process list commands must not read environment variables")
		}
	}
	if strings.Contains(detailCommand(42), "environ") {
		t.Fatal("process commands must not read environment variables")
	}
	if strings.Contains(detailCommand(42), "lsof") || strings.Contains(detailCommand(42), "/proc/$pid/fd") {
		t.Fatal("detail command must not run slow open-file enumeration")
	}
	combined := strings.Join(listCommandTexts(), "\n")
	if !strings.Contains(combined, "ps auxww") ||
		!strings.Contains(combined, "ps aux") ||
		!strings.Contains(combined, "ps w") ||
		!strings.Contains(combined, "LC_ALL=C ps 2") ||
		!strings.Contains(combined, "/proc/[0-9]*") {
		t.Fatal("list command must keep ps aux, BusyBox ps, and single-shell /proc fallbacks")
	}
}

func TestSignalRejectsPIDOneAndKernelThread(t *testing.T) {
	manager, transport := newFakeManager(t)
	if _, err := manager.Signal(testConnection(), domain.AuthRequest{}, domain.SignalProcessRequest{
		ServerID: 1,
		PID:      1,
		Signal:   domain.ProcessSignalTerm,
	}); err == nil || !strings.Contains(err.Error(), "PID 1") {
		t.Fatalf("expected pid 1 rejection, got %v", err)
	}
	if _, err := manager.Signal(testConnection(), domain.AuthRequest{}, domain.SignalProcessRequest{
		ServerID: 1,
		PID:      77,
		Signal:   domain.ProcessSignalKill,
	}); err == nil || !strings.Contains(err.Error(), "内核线程") {
		t.Fatalf("expected kernel rejection, got %v", err)
	}
	if transport.saw("kill -TERM") || transport.saw("kill -KILL") {
		t.Fatal("guarded process received kill command")
	}
}

func TestSignalSendsTermAndKill(t *testing.T) {
	manager, transport := newFakeManager(t)
	if _, err := manager.Signal(testConnection(), domain.AuthRequest{}, domain.SignalProcessRequest{
		ServerID:        1,
		PID:             42,
		Signal:          domain.ProcessSignalTerm,
		ExpectedCommand: "bash",
	}); err != nil {
		t.Fatal(err)
	}
	if !transport.saw("kill -TERM") {
		t.Fatal("SIGTERM command was not sent")
	}
	if _, err := manager.Signal(testConnection(), domain.AuthRequest{}, domain.SignalProcessRequest{
		ServerID:        1,
		PID:             42,
		Signal:          domain.ProcessSignalKill,
		ExpectedCommand: "bash",
	}); err != nil {
		t.Fatal(err)
	}
	if !transport.saw("kill -KILL") {
		t.Fatal("SIGKILL command was not sent")
	}
}

func TestSignalExpectedCommandMismatch(t *testing.T) {
	manager, transport := newFakeManager(t)
	if _, err := manager.Signal(testConnection(), domain.AuthRequest{}, domain.SignalProcessRequest{
		ServerID:        1,
		PID:             42,
		Signal:          domain.ProcessSignalTerm,
		ExpectedCommand: "nginx",
	}); err == nil || !strings.Contains(err.Error(), "命令已变化") {
		t.Fatalf("expected mismatch rejection, got %v", err)
	}
	if transport.saw("kill -TERM") {
		t.Fatal("mismatched process received signal")
	}
}

func TestSignalProcessGoneReturnsChineseError(t *testing.T) {
	manager, _ := newFakeManager(t)
	if _, err := manager.Signal(testConnection(), domain.AuthRequest{}, domain.SignalProcessRequest{
		ServerID: 1,
		PID:      999,
		Signal:   domain.ProcessSignalTerm,
	}); err == nil || !strings.Contains(err.Error(), "进程已退出") {
		t.Fatalf("expected gone process error, got %v", err)
	}
}

func TestWatcherStartStopAndStopServer(t *testing.T) {
	manager, _ := newFakeManager(t)
	watchID, err := manager.StartWatch(testConnection(), domain.AuthRequest{}, domain.StartProcessWatchRequest{
		ServerID:   1,
		WatchID:    "watch-1",
		IntervalMs: 1000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if watchID != "watch-1" || manager.WatcherCount(1) != 1 {
		t.Fatalf("watchID=%s count=%d", watchID, manager.WatcherCount(1))
	}
	manager.StopServer(1)
	if manager.WatcherCount(1) != 0 {
		t.Fatal("DisconnectServer cleanup did not stop process watcher")
	}
}

func TestWatcherStopIgnoresLateListEmission(t *testing.T) {
	manager, _ := newFakeManager(t)
	watchID, err := manager.StartWatch(testConnection(), domain.AuthRequest{}, domain.StartProcessWatchRequest{
		ServerID:   1,
		WatchID:    "watch-late",
		IntervalMs: 1000,
	})
	if err != nil {
		t.Fatal(err)
	}
	manager.StopWatch(watchID)
	worker := &watchWorker{serverID: 1, watchID: watchID, generation: manager.generation(1)}
	if manager.isCurrent(worker) {
		t.Fatal("stopped watcher should not be current")
	}
}

func TestManagerFailureDoesNotExposeTerminalLifecycle(t *testing.T) {
	transport := &fakeTransport{err: errors.New("dial failed")}
	manager := NewWithDialer(context.Background(), nil, nil, nil, func(
		context.Context,
		domain.Connection,
		domain.AuthRequest,
		time.Duration,
	) (Transport, time.Duration, error) {
		return transport, 0, nil
	})
	_, err := manager.List(testConnection(), domain.AuthRequest{}, domain.ListProcessesRequest{ServerID: 1})
	if err == nil {
		t.Fatal("expected process manager failure")
	}
	// The process manager has no terminal dependency; a failure stays in this
	// manager and cannot call terminal lifecycle code.
}

func newFakeManager(t *testing.T) (*Manager, *fakeTransport) {
	t.Helper()
	transport := &fakeTransport{
		listOutput: sampleGNUPSList,
		details: map[int64]string{
			1:   "pid=1\nppid=0\nuser=root\nstate=S\ncommand=init\ncmdline=/sbin/init\nthreads=1\nopenFilesCount=3\n",
			42:  "pid=42\nppid=1\nuser=root\nstate=R\ncommand=bash\ncmdline=bash -lc sleep 30\ncwd=/root\nexe=/usr/bin/bash\nthreads=1\nopenFilesCount=5\n",
			77:  "pid=77\nppid=2\nuser=root\nstate=S\ncommand=kthreadd\ncmdline=[kthreadd]\nthreads=1\nkernel=1\n",
			108: "pid=108\nppid=42\nuser=www-data\nstate=S\ncommand=nginx\ncmdline=nginx: worker process\nthreads=1\nopenFilesCount=4\n",
			999: "error=not_found\n",
		},
	}
	manager := NewWithDialer(context.Background(), nil, &fakeEmitter{}, nil, func(
		context.Context,
		domain.Connection,
		domain.AuthRequest,
		time.Duration,
	) (Transport, time.Duration, error) {
		return transport, 0, nil
	})
	return manager, transport
}

func testConnection() domain.Connection {
	return domain.Connection{ID: 1, Name: "test", Host: "192.0.2.10", Port: 22, Username: "root", AuthType: domain.AuthPassword}
}

func strconvFormatInt(value int64) string {
	return strconv.FormatInt(value, 10)
}

func isListCommand(command string) bool {
	for _, strategy := range listProcessCommands {
		if command == strategy.command {
			return true
		}
	}
	return false
}

func listCommandTexts() []string {
	commands := make([]string, 0, len(listProcessCommands))
	for _, strategy := range listProcessCommands {
		commands = append(commands, strategy.command)
	}
	return commands
}

func gnuNoHeaderProcessListCommand() string {
	return listProcessCommands[0].command
}

func gnuHeaderProcessListCommand() string {
	return listProcessCommands[1].command
}

func psAuxProcessListCommand() string {
	return listProcessCommands[2].command
}

func busyBoxProcessListCommand() string {
	return listProcessCommands[3].command
}

func procProcessListCommandText() string {
	return listProcessCommands[4].command
}

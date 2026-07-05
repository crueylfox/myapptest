package tunnelmanager

import (
	"context"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"serverpilot/internal/domain"
)

type fakeTransport struct {
	mu          sync.Mutex
	dialed      []string
	listened    []string
	listeners   []net.Listener
	listenErr   error
	runOutput   string
	runErr      error
	runFunc     func(command string) (string, error)
	runCommands []string
	closeCount  int
}

func (t *fakeTransport) DialTCP(address string) (net.Conn, error) {
	t.mu.Lock()
	t.dialed = append(t.dialed, address)
	t.mu.Unlock()
	left, right := net.Pipe()
	go func() {
		defer right.Close()
		buf := make([]byte, 4096)
		n, err := right.Read(buf)
		if err == nil && n > 0 {
			_, _ = right.Write([]byte("remote:" + string(buf[:n])))
		}
	}()
	return left, nil
}

func (t *fakeTransport) ListenTCP(address string) (net.Listener, error) {
	t.mu.Lock()
	t.listened = append(t.listened, address)
	err := t.listenErr
	t.mu.Unlock()
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	t.mu.Lock()
	t.listeners = append(t.listeners, listener)
	t.mu.Unlock()
	return listener, nil
}

func (t *fakeTransport) Run(_ context.Context, command string) (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.runCommands = append(t.runCommands, command)
	if t.runFunc != nil {
		return t.runFunc(command)
	}
	if t.runErr != nil {
		return "", t.runErr
	}
	if command == remoteListenProbeCommand && t.runOutput != "" && !t.hasOpenListenerLocked() {
		return "__SERVERPILOT_LISTEN_TOOL:ss\n", nil
	}
	return t.runOutput, nil
}

func (t *fakeTransport) Fingerprint() string {
	return "SHA256:test"
}

func (t *fakeTransport) Close() error {
	t.mu.Lock()
	t.closeCount++
	t.mu.Unlock()
	return nil
}

func (t *fakeTransport) hasOpenListenerLocked() bool {
	for _, listener := range t.listeners {
		if listener == nil || listener.Addr() == nil {
			continue
		}
		conn, err := net.DialTimeout("tcp", listener.Addr().String(), 20*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return true
		}
	}
	return false
}

func (t *fakeTransport) dialCount() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.dialed)
}

func (t *fakeTransport) lastDial() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.dialed) == 0 {
		return ""
	}
	return t.dialed[len(t.dialed)-1]
}

func (t *fakeTransport) lastListenerAddr() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.listeners) == 0 {
		return ""
	}
	return t.listeners[len(t.listeners)-1].Addr().String()
}

func (t *fakeTransport) runCount() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.runCommands)
}

func newTestManager(ctx context.Context, transport *fakeTransport) *Manager {
	return NewWithDialer(ctx, nil, nil, func() time.Duration { return time.Second }, func(
		context.Context,
		domain.Connection,
		domain.AuthRequest,
		time.Duration,
	) (Transport, time.Duration, error) {
		return transport, time.Millisecond, nil
	})
}

func testConnection(id int64) domain.Connection {
	return domain.Connection{
		ID: id, Name: "server", Host: "127.0.0.1", Port: 22,
		Username: "root", AuthType: domain.AuthPassword,
	}
}

func TestLocalTunnelStartsUsesIndependentDialerAndForwardsData(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	transport := &fakeTransport{}
	manager := newTestManager(ctx, transport)
	port := freePort(t)
	state, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeLocal, BindHost: "127.0.0.1", BindPort: port,
		TargetHost: "127.0.0.1", TargetPort: 80,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Stop(domain.StopTunnelRequest{ServerID: 1, TunnelID: state.TunnelID})

	conn, err := net.Dial("tcp", net.JoinHostPort(state.BindHost, strconv.Itoa(state.BindPort)))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte("ping")); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 64)
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	n, err := conn.Read(buf)
	if err != nil {
		t.Fatal(err)
	}
	if string(buf[:n]) != "remote:ping" {
		t.Fatalf("forwarded response = %q", string(buf[:n]))
	}
	if transport.dialCount() != 1 || transport.lastDial() != "127.0.0.1:80" {
		t.Fatalf("dialed targets = count %d last %q", transport.dialCount(), transport.lastDial())
	}
}

func TestStopLocalTunnelClosesListener(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	manager := newTestManager(ctx, &fakeTransport{})
	port := freePort(t)
	state, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeLocal, BindHost: "127.0.0.1", BindPort: port,
		TargetHost: "127.0.0.1", TargetPort: 80,
	})
	if err != nil {
		t.Fatal(err)
	}
	address := net.JoinHostPort(state.BindHost, strconv.Itoa(state.BindPort))
	if err := manager.Stop(domain.StopTunnelRequest{ServerID: 1, TunnelID: state.TunnelID}); err != nil {
		t.Fatal(err)
	}
	if conn, err := net.DialTimeout("tcp", address, 100*time.Millisecond); err == nil {
		_ = conn.Close()
		t.Fatal("listener still accepts connections after stop")
	}
}

func TestStopProfileReleasesLocalRemoteAndDynamicListeners(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	transport := &fakeTransport{runOutput: "LISTEN 0 128 0.0.0.0:9100 0.0.0.0:*"}
	manager := newTestManager(ctx, transport)

	localPort := freePort(t)
	local, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		ProfileID: 11, Type: domain.TunnelTypeLocal, BindHost: "127.0.0.1", BindPort: localPort,
		TargetHost: "127.0.0.1", TargetPort: 80,
	})
	if err != nil {
		t.Fatal(err)
	}
	remote, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		ProfileID: 11, Type: domain.TunnelTypeRemote, RemoteBindHost: "0.0.0.0", RemoteBindPort: 9100,
		TargetHost: "127.0.0.1", TargetPort: 3000, ConfirmPublicBind: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	dynamicPort := freePort(t)
	dynamic, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		ProfileID: 12, Type: domain.TunnelTypeDynamic, BindHost: "127.0.0.1", BindPort: dynamicPort,
	})
	if err != nil {
		t.Fatal(err)
	}
	localAddress := net.JoinHostPort(local.BindHost, strconv.Itoa(local.BindPort))
	remoteAddress := transport.lastListenerAddr()
	dynamicAddress := net.JoinHostPort(dynamic.BindHost, strconv.Itoa(dynamic.BindPort))

	assertAccepts(t, localAddress)
	assertAccepts(t, remoteAddress)
	assertAccepts(t, dynamicAddress)

	if err := manager.StopProfile(11); err != nil {
		t.Fatal(err)
	}
	assertRefused(t, localAddress)
	assertRefused(t, remoteAddress)
	assertAccepts(t, dynamicAddress)
	if _, err := manager.State(local.TunnelID); err == nil {
		t.Fatal("local tunnel remained after StopProfile")
	}
	if _, err := manager.State(remote.TunnelID); err == nil {
		t.Fatal("remote tunnel remained after StopProfile")
	}
	if _, err := manager.State(dynamic.TunnelID); err != nil {
		t.Fatalf("unrelated dynamic tunnel stopped: %v", err)
	}

	if err := manager.StopProfile(12); err != nil {
		t.Fatal(err)
	}
	assertRefused(t, dynamicAddress)
}

func TestStopTunnelIsIdempotentAndClosesActiveConnections(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	manager := newTestManager(ctx, &fakeTransport{})
	port := freePort(t)
	state, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeLocal, BindHost: "127.0.0.1", BindPort: port,
		TargetHost: "127.0.0.1", TargetPort: 80,
	})
	if err != nil {
		t.Fatal(err)
	}
	address := net.JoinHostPort(state.BindHost, strconv.Itoa(state.BindPort))
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Stop(domain.StopTunnelRequest{ServerID: 1, TunnelID: state.TunnelID}); err != nil {
		t.Fatal(err)
	}
	if err := manager.Stop(domain.StopTunnelRequest{ServerID: 1, TunnelID: state.TunnelID}); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	buf := make([]byte, 1)
	if _, err := conn.Read(buf); err == nil {
		t.Fatal("active connection still readable after StopTunnel")
	}
	_ = conn.Close()
	assertRefused(t, address)
}

func TestDynamicSocksConnectUsesTunnelDial(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	transport := &fakeTransport{}
	manager := newTestManager(ctx, transport)
	port := freePort(t)
	state, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeDynamic, BindHost: "127.0.0.1", BindPort: port,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Stop(domain.StopTunnelRequest{ServerID: 1, TunnelID: state.TunnelID})

	conn, err := net.Dial("tcp", net.JoinHostPort(state.BindHost, strconv.Itoa(state.BindPort)))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte{0x05, 0x01, 0x00}); err != nil {
		t.Fatal(err)
	}
	if reply := readBytes(t, conn, 2); string(reply) != string([]byte{0x05, 0x00}) {
		t.Fatalf("SOCKS greeting reply = %v", reply)
	}
	host := []byte("example.com")
	request := append([]byte{0x05, 0x01, 0x00, 0x03, byte(len(host))}, host...)
	request = append(request, 0x00, 0x50)
	if _, err := conn.Write(request); err != nil {
		t.Fatal(err)
	}
	reply := readBytes(t, conn, 10)
	if reply[1] != 0x00 {
		t.Fatalf("SOCKS connect reply = %v", reply)
	}
	if transport.lastDial() != "example.com:80" {
		t.Fatalf("dialed target = %q", transport.lastDial())
	}
}

func TestDynamicSocksRejectsBindAndUDP(t *testing.T) {
	for _, command := range []byte{0x02, 0x03} {
		t.Run(strconv.Itoa(int(command)), func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			manager := newTestManager(ctx, &fakeTransport{})
			port := freePort(t)
			state, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
				Type: domain.TunnelTypeDynamic, BindHost: "127.0.0.1", BindPort: port,
			})
			if err != nil {
				t.Fatal(err)
			}
			defer manager.Stop(domain.StopTunnelRequest{ServerID: 1, TunnelID: state.TunnelID})
			conn, err := net.Dial("tcp", net.JoinHostPort(state.BindHost, strconv.Itoa(state.BindPort)))
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			_, _ = conn.Write([]byte{0x05, 0x01, 0x00})
			_ = readBytes(t, conn, 2)
			_, _ = conn.Write([]byte{0x05, command, 0x00, 0x01, 127, 0, 0, 1, 0, 80})
			reply := readBytes(t, conn, 10)
			if reply[1] != 0x07 {
				t.Fatalf("unsupported command reply = %v", reply)
			}
		})
	}
}

func TestRemoteTunnelStartsAndReportsRejectedListen(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	transport := &fakeTransport{runOutput: "LISTEN 0 128 127.0.0.1:9000 0.0.0.0:*"}
	manager := newTestManager(ctx, transport)
	state, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeRemote, RemoteBindHost: "127.0.0.1", RemoteBindPort: 9000,
		TargetHost: "127.0.0.1", TargetPort: 3000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != domain.TunnelStatusRunning {
		t.Fatalf("status=%s", state.Status)
	}
	if state.RemoteListenCheckStatus != domain.RemoteListenLoopback {
		t.Fatalf("remote listen status=%s", state.RemoteListenCheckStatus)
	}
	if state.RemoteListenExposure != domain.RemoteListenExposureLoopbackOnly {
		t.Fatalf("remote listen exposure=%s", state.RemoteListenExposure)
	}
	_ = manager.Stop(domain.StopTunnelRequest{ServerID: 1, TunnelID: state.TunnelID})

	rejected := &fakeTransport{listenErr: errors.New("administratively prohibited")}
	manager = newTestManager(ctx, rejected)
	_, err = manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeRemote, RemoteBindHost: "127.0.0.1", RemoteBindPort: 9000,
		TargetHost: "127.0.0.1", TargetPort: 3000,
	})
	if err == nil || !strings.Contains(UserMessage(err), "远程端口转发") {
		t.Fatalf("remote reject error = %v message=%q", err, UserMessage(err))
	}
}

func TestRemoteTunnelListenerStaysOpenUntilStop(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	transport := &fakeTransport{runOutput: "LISTEN 0 128 0.0.0.0:9100 0.0.0.0:*"}
	manager := newTestManager(ctx, transport)
	state, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeRemote, RemoteBindHost: "0.0.0.0", RemoteBindPort: 9100,
		TargetHost: "127.0.0.1", TargetPort: 3000, ConfirmPublicBind: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	address := transport.lastListenerAddr()
	if address == "" {
		t.Fatal("remote listener was not retained")
	}
	conn, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatalf("remote listener is not accepting after Start returned: %v", err)
	}
	_ = conn.Close()

	if err := manager.Stop(domain.StopTunnelRequest{ServerID: 1, TunnelID: state.TunnelID}); err != nil {
		t.Fatal(err)
	}
	if conn, err := net.DialTimeout("tcp", address, 100*time.Millisecond); err == nil {
		_ = conn.Close()
		t.Fatal("remote listener still accepts after StopTunnel")
	}
}

func TestRemoteTunnelFailsWhenListenCheckDoesNotFindPort(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	transport := &fakeTransport{runOutput: "LISTEN 0 128 127.0.0.1:22 0.0.0.0:*"}
	manager := newTestManager(ctx, transport)
	_, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeRemote, RemoteBindHost: "0.0.0.0", RemoteBindPort: 9200,
		TargetHost: "127.0.0.1", TargetPort: 3000, ConfirmPublicBind: true,
	})
	if err == nil {
		t.Fatal("expected remote listen verification failure")
	}
	if got := UserMessage(err); got != "远程端口未监听，隧道启动失败。" {
		t.Fatalf("message=%q", got)
	}
	if len(manager.List(1)) != 0 {
		t.Fatal("failed remote tunnel should not remain running")
	}
}

func TestRemoteTunnelUnknownListenCheckKeepsRunningWithWarning(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	transport := &fakeTransport{runOutput: "__SERVERPILOT_LISTEN_TOOL:missing\n"}
	manager := newTestManager(ctx, transport)
	state, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeRemote, RemoteBindHost: "0.0.0.0", RemoteBindPort: 9300,
		TargetHost: "127.0.0.1", TargetPort: 80, ConfirmPublicBind: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Stop(domain.StopTunnelRequest{ServerID: 1, TunnelID: state.TunnelID})
	if state.Status != domain.TunnelStatusRunning {
		t.Fatalf("status=%s", state.Status)
	}
	if state.RemoteListenCheckStatus != domain.RemoteListenUnknown {
		t.Fatalf("remote listen status=%s", state.RemoteListenCheckStatus)
	}
	if state.RemoteListenExposure != domain.RemoteListenExposureUnknown {
		t.Fatalf("remote listen exposure=%s", state.RemoteListenExposure)
	}
	if !strings.Contains(state.RemoteListenWarning, "无法确认") {
		t.Fatalf("warning=%q", state.RemoteListenWarning)
	}
}

func TestCheckRemoteListenUpdatesRunningTunnel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	transport := &fakeTransport{runOutput: "LISTEN 0 128 127.0.0.1:9400 0.0.0.0:*"}
	manager := newTestManager(ctx, transport)
	state, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeRemote, RemoteBindHost: "0.0.0.0", RemoteBindPort: 9400,
		TargetHost: "127.0.0.1", TargetPort: 22, ConfirmPublicBind: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Stop(domain.StopTunnelRequest{ServerID: 1, TunnelID: state.TunnelID})
	if state.RemoteListenCheckStatus != domain.RemoteListenLoopback {
		t.Fatalf("remote listen status=%s", state.RemoteListenCheckStatus)
	}
	if state.RemoteListenExposure != domain.RemoteListenExposureLoopbackOnly {
		t.Fatalf("remote listen exposure=%s", state.RemoteListenExposure)
	}
	if !strings.Contains(state.RemoteListenWarning, "GatewayPorts") {
		t.Fatalf("warning=%q", state.RemoteListenWarning)
	}
	if state.TestCommand != "ssh -p 9400 root@127.0.0.1" {
		t.Fatalf("loopback test command=%q", state.TestCommand)
	}
	transport.mu.Lock()
	transport.runOutput = "LISTEN 0 128 0.0.0.0:9400 0.0.0.0:*"
	transport.mu.Unlock()
	updated, err := manager.CheckRemoteListen(domain.CheckTunnelRemoteListenRequest{ServerID: 1, TunnelID: state.TunnelID})
	if err != nil {
		t.Fatal(err)
	}
	if updated.RemoteListenCheckStatus != domain.RemoteListenListening {
		t.Fatalf("remote listen status=%s", updated.RemoteListenCheckStatus)
	}
	if updated.EffectiveRemoteBindHost != "0.0.0.0" {
		t.Fatalf("effective host=%q", updated.EffectiveRemoteBindHost)
	}
	if updated.RemoteListenExposure != domain.RemoteListenExposurePublic {
		t.Fatalf("remote listen exposure=%s", updated.RemoteListenExposure)
	}
	if updated.TestCommand != "ssh -p 9400 root@127.0.0.1" {
		t.Fatalf("test command=%q", updated.TestCommand)
	}
	if transport.runCount() < 2 {
		t.Fatalf("remote listen check did not rerun")
	}
}

func TestParseRemoteListenOutputClassifiesHostsAndCommands(t *testing.T) {
	cases := []struct {
		name      string
		output    string
		requested string
		status    domain.RemoteListenCheckStatus
		exposure  domain.RemoteListenExposure
		effective string
		actual    string
		addrs     []string
	}{
		{
			name: "wildcard ipv4", output: "LISTEN 0 128 0.0.0.0:12380 0.0.0.0:*",
			requested: "0.0.0.0", status: domain.RemoteListenListening, exposure: domain.RemoteListenExposurePublic,
			effective: "0.0.0.0", actual: "0.0.0.0:12380", addrs: []string{"0.0.0.0:12380"},
		},
		{
			name: "loopback downgraded", output: "LISTEN 0 128 127.0.0.1:12380 0.0.0.0:*",
			requested: "0.0.0.0", status: domain.RemoteListenLoopback, exposure: domain.RemoteListenExposureLoopbackOnly,
			effective: "127.0.0.1", actual: "127.0.0.1:12380", addrs: []string{"127.0.0.1:12380"},
		},
		{
			name: "loopback ipv6", output: "LISTEN 0 128 [::1]:12380 [::]:*",
			requested: "0.0.0.0", status: domain.RemoteListenLoopback, exposure: domain.RemoteListenExposureLoopbackOnly,
			effective: "::1", actual: "[::1]:12380", addrs: []string{"[::1]:12380"},
		},
		{
			name: "dual loopback", output: "LISTEN 0 128 127.0.0.1:12380 0.0.0.0:*\nLISTEN 0 128 [::1]:12380 [::]:*",
			requested: "0.0.0.0", status: domain.RemoteListenLoopback, exposure: domain.RemoteListenExposureLoopbackOnly,
			effective: "127.0.0.1", actual: "127.0.0.1:12380\n[::1]:12380", addrs: []string{"127.0.0.1:12380", "[::1]:12380"},
		},
		{
			name: "ipv6 wildcard", output: "LISTEN 0 128 [::]:12380 [::]:*",
			requested: "::", status: domain.RemoteListenListening, exposure: domain.RemoteListenExposurePublic,
			effective: "::", actual: "[::]:12380", addrs: []string{"[::]:12380"},
		},
		{
			name: "specific public host", output: "LISTEN 0 128 192.168.0.88:12380 0.0.0.0:*",
			requested: "0.0.0.0", status: domain.RemoteListenListening, exposure: domain.RemoteListenExposurePublic,
			effective: "192.168.0.88", actual: "192.168.0.88:12380", addrs: []string{"192.168.0.88:12380"},
		},
		{
			name: "public wins over loopback", output: "LISTEN 0 128 127.0.0.1:12380 0.0.0.0:*\nLISTEN 0 128 0.0.0.0:12380 0.0.0.0:*",
			requested: "0.0.0.0", status: domain.RemoteListenListening, exposure: domain.RemoteListenExposurePublic,
			effective: "0.0.0.0", actual: "127.0.0.1:12380\n0.0.0.0:12380", addrs: []string{"127.0.0.1:12380", "0.0.0.0:12380"},
		},
		{
			name: "netstat no port", output: "tcp 0 0 127.0.0.1:22 0.0.0.0:* LISTEN",
			requested: "0.0.0.0", status: domain.RemoteListenNotFound, exposure: domain.RemoteListenExposureNotListening,
			effective: "unknown", actual: "", addrs: nil,
		},
		{
			name: "tool missing", output: "__SERVERPILOT_LISTEN_TOOL:missing",
			requested: "0.0.0.0", status: domain.RemoteListenUnknown, exposure: domain.RemoteListenExposureUnknown,
			effective: "unknown", actual: "", addrs: nil,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := parseRemoteListenOutput(tc.output, tc.requested, 12380)
			if result.Status != tc.status || result.Exposure != tc.exposure || result.EffectiveHost != tc.effective || result.ActualListen != tc.actual {
				t.Fatalf("result=%+v", result)
			}
			if strings.Join(result.EffectiveAddrs, "|") != strings.Join(tc.addrs, "|") {
				t.Fatalf("effective addrs=%v", result.EffectiveAddrs)
			}
		})
	}
}

func TestRemoteTunnelTestCommandUsesProtocolSpecificCommand(t *testing.T) {
	httpWorker := &worker{
		request:    domain.StartTunnelRequest{Type: domain.TunnelTypeRemote, RemoteBindPort: 12380, TargetPort: 80},
		serverHost: "192.168.0.88", serverUser: "admin",
	}
	if got := httpWorker.testCommand(remoteListenResult{EffectiveHost: "0.0.0.0", Exposure: domain.RemoteListenExposurePublic}); got != "curl http://192.168.0.88:12380" {
		t.Fatalf("http command=%q", got)
	}
	if got := httpWorker.testCommand(remoteListenResult{EffectiveHost: "127.0.0.1", Exposure: domain.RemoteListenExposureLoopbackOnly}); got != "curl http://127.0.0.1:12380" {
		t.Fatalf("loopback http command=%q", got)
	}
	sshWorker := &worker{
		request:    domain.StartTunnelRequest{Type: domain.TunnelTypeRemote, RemoteBindPort: 12380, TargetPort: 22},
		serverHost: "192.168.0.88", serverUser: "root",
	}
	if got := sshWorker.testCommand(remoteListenResult{EffectiveHost: "127.0.0.1", Exposure: domain.RemoteListenExposureLoopbackOnly}); got != "ssh -p 12380 root@127.0.0.1" {
		t.Fatalf("ssh command=%q", got)
	}
	if got := sshWorker.testCommand(remoteListenResult{EffectiveHost: "0.0.0.0", Exposure: domain.RemoteListenExposurePublic}); got != "ssh -p 12380 root@192.168.0.88" {
		t.Fatalf("public ssh command=%q", got)
	}
}

func TestInspectRemoteForwardAccessParsesOpenSSHAndDropbear(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	transport := &fakeTransport{runOutput: "LISTEN 0 128 127.0.0.1:9500 0.0.0.0:*"}
	manager := newTestManager(ctx, transport)
	state, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeRemote, RemoteBindHost: "0.0.0.0", RemoteBindPort: 9500,
		TargetHost: "127.0.0.1", TargetPort: 22, ConfirmPublicBind: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Stop(domain.StopTunnelRequest{ServerID: 1, TunnelID: state.TunnelID})

	transport.mu.Lock()
	transport.runOutput = strings.Join([]string{
		"__SP_SSHD_TYPE=openssh",
		"__SP_CONFIG_PATH=/etc/ssh/sshd_config",
		"__SP_GATEWAYPORTS=no",
		"__SP_ALLOWTCPFORWARDING=yes",
		"__SP_CAN_MODIFY=yes",
		"__SP_REQUIRES_SUDO=no",
	}, "\n")
	transport.mu.Unlock()
	inspect, err := manager.InspectRemoteForwardAccess(domain.RemoteForwardAccessRequest{ServerID: 1, TunnelID: state.TunnelID})
	if err != nil {
		t.Fatal(err)
	}
	if inspect.SSHDType != "openssh" || inspect.ConfigPath != "/etc/ssh/sshd_config" || inspect.GatewayPortsEffective != "no" {
		t.Fatalf("inspect=%+v", inspect)
	}
	if !inspect.CanModify || inspect.RequiresSudo {
		t.Fatalf("inspect permissions=%+v", inspect)
	}

	transport.mu.Lock()
	transport.runOutput = strings.Join([]string{
		"__SP_SSHD_TYPE=dropbear",
		"__SP_CONFIG_PATH=",
		"__SP_GATEWAYPORTS=unknown",
		"__SP_ALLOWTCPFORWARDING=unknown",
		"__SP_CAN_MODIFY=no",
		"__SP_REQUIRES_SUDO=no",
	}, "\n")
	transport.mu.Unlock()
	inspect, err = manager.InspectRemoteForwardAccess(domain.RemoteForwardAccessRequest{ServerID: 1, TunnelID: state.TunnelID})
	if err != nil {
		t.Fatal(err)
	}
	if inspect.SSHDType != "dropbear" || inspect.CanModify || len(inspect.Warnings) == 0 {
		t.Fatalf("dropbear inspect=%+v", inspect)
	}
}

func TestEnableRemoteForwardAccessReportsBackupReloadAndErrors(t *testing.T) {
	if strings.Contains(enableRemoteForwardAccessCommand, "AllowTcpForwarding yes") ||
		strings.Contains(enableRemoteForwardAccessCommand, "allowtcpforwarding yes") {
		t.Fatal("enable script must not modify AllowTcpForwarding")
	}
	if !strings.Contains(enableRemoteForwardAccessCommand, "GatewayPorts yes") {
		t.Fatal("enable script must set GatewayPorts yes")
	}
	if !strings.Contains(enableRemoteForwardAccessCommand, "sshd -t") {
		t.Fatal("enable script must validate sshd config")
	}
	if !strings.Contains(enableRemoteForwardAccessCommand, "cp -p \"$BACKUP\" \"$CONFIG\"") {
		t.Fatal("enable script must rollback config on validation failure")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	transport := &fakeTransport{runOutput: "LISTEN 0 128 127.0.0.1:9600 0.0.0.0:*"}
	manager := newTestManager(ctx, transport)
	state, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeRemote, RemoteBindHost: "0.0.0.0", RemoteBindPort: 9600,
		TargetHost: "127.0.0.1", TargetPort: 22, ConfirmPublicBind: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Stop(domain.StopTunnelRequest{ServerID: 1, TunnelID: state.TunnelID})

	transport.mu.Lock()
	transport.runOutput = strings.Join([]string{
		"__SP_RESULT=success",
		"__SP_BACKUP=/etc/ssh/sshd_config.serverpilot.bak.20260618210000",
		"__SP_CHANGED=/etc/ssh/sshd_config",
		"__SP_RELOAD=systemctl reload sshd",
	}, "\n")
	transport.mu.Unlock()
	enabled, err := manager.EnableRemoteForwardAccess(domain.RemoteForwardAccessRequest{ServerID: 1, TunnelID: state.TunnelID})
	if err != nil {
		t.Fatal(err)
	}
	if !enabled.Success || enabled.BackupPath == "" || enabled.ReloadCommand != "systemctl reload sshd" || len(enabled.ChangedFiles) != 1 {
		t.Fatalf("enable result=%+v", enabled)
	}

	transport.mu.Lock()
	transport.runOutput = strings.Join([]string{
		"__SP_RESULT=validation_failed",
		"__SP_MESSAGE=sshd -t 验证失败，已回滚 sshd_config。",
		"__SP_BACKUP=/etc/ssh/sshd_config.serverpilot.bak.20260618210001",
	}, "\n")
	transport.mu.Unlock()
	_, err = manager.EnableRemoteForwardAccess(domain.RemoteForwardAccessRequest{ServerID: 1, TunnelID: state.TunnelID})
	if err == nil || !strings.Contains(err.Error(), "已回滚") {
		t.Fatalf("validation failure err=%v", err)
	}

	transport.mu.Lock()
	transport.runOutput = "__SP_RESULT=unsupported\n__SP_MESSAGE=当前服务器可能使用 Dropbear，本轮暂不自动修改 GatewayPorts。"
	transport.mu.Unlock()
	_, err = manager.EnableRemoteForwardAccess(domain.RemoteForwardAccessRequest{ServerID: 1, TunnelID: state.TunnelID})
	if err == nil || !strings.Contains(err.Error(), "Dropbear") {
		t.Fatalf("dropbear err=%v", err)
	}
}

func TestEnableRemoteForwardAccessAndStopStopsBeforeGatewayPorts(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	transport := &fakeTransport{}
	transport.runFunc = func(command string) (string, error) {
		if command == remoteListenProbeCommand {
			if transport.hasOpenListenerLocked() {
				return "LISTEN 0 128 127.0.0.1:9700 0.0.0.0:*", nil
			}
			return "__SERVERPILOT_LISTEN_TOOL:ss\n", nil
		}
		if strings.Contains(command, "SERVERPILOT_ENABLE_GATEWAYPORTS") {
			if transport.hasOpenListenerLocked() {
				return "__SP_RESULT=failed\n__SP_MESSAGE=listener was still open", nil
			}
			return strings.Join([]string{
				"__SP_RESULT=success",
				"__SP_BACKUP=/etc/ssh/sshd_config.serverpilot.bak.20260618210000",
				"__SP_CHANGED=/etc/ssh/sshd_config",
				"__SP_RELOAD=systemctl reload sshd",
			}, "\n"), nil
		}
		return "", nil
	}
	manager := newTestManager(ctx, transport)
	state, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		ProfileID: 77, Type: domain.TunnelTypeRemote, RemoteBindHost: "0.0.0.0", RemoteBindPort: 9700,
		TargetHost: "127.0.0.1", TargetPort: 22, ConfirmPublicBind: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	address := transport.lastListenerAddr()
	assertAccepts(t, address)

	result, startRequest, err := manager.EnableRemoteForwardAccessAndStop(domain.RemoteForwardAccessRequest{
		ServerID: 1,
		TunnelID: state.TunnelID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.ReloadCommand != "systemctl reload sshd" {
		t.Fatalf("enable result=%+v", result)
	}
	if startRequest.ProfileID != 77 || startRequest.RemoteBindPort != 9700 {
		t.Fatalf("start request=%+v", startRequest)
	}
	assertRefused(t, address)
	if _, err := manager.State(state.TunnelID); err == nil {
		t.Fatal("old tunnel should be removed after remote access restart preparation")
	}
	transport.mu.Lock()
	commands := append([]string(nil), transport.runCommands...)
	transport.mu.Unlock()
	var releaseProbeIndex, enableIndex = -1, -1
	for index, command := range commands {
		if command == remoteListenProbeCommand {
			releaseProbeIndex = index
		}
		if strings.Contains(command, "SERVERPILOT_ENABLE_GATEWAYPORTS") {
			enableIndex = index
		}
	}
	if releaseProbeIndex < 0 || enableIndex < 0 || releaseProbeIndex > enableIndex {
		t.Fatalf("expected release probe before GatewayPorts enable, commands=%v", commands)
	}
}

func TestPublicBindRequiresConfirmation(t *testing.T) {
	manager := newTestManager(context.Background(), &fakeTransport{})
	_, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeLocal, BindHost: "0.0.0.0", BindPort: 18080,
		TargetHost: "127.0.0.1", TargetPort: 80,
	})
	if !errors.Is(err, ErrPublicBindRequiresConfirmation) {
		t.Fatalf("err=%v", err)
	}
}

func TestStopServerOnlyStopsTargetServerTunnels(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	manager := newTestManager(ctx, &fakeTransport{})
	firstPort := freePort(t)
	first, err := manager.Start(testConnection(1), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeLocal, BindHost: "127.0.0.1", BindPort: firstPort,
		TargetHost: "127.0.0.1", TargetPort: 80,
	})
	if err != nil {
		t.Fatal(err)
	}
	secondPort := freePort(t)
	second, err := manager.Start(testConnection(2), domain.AuthRequest{}, domain.StartTunnelRequest{
		Type: domain.TunnelTypeLocal, BindHost: "127.0.0.1", BindPort: secondPort,
		TargetHost: "127.0.0.1", TargetPort: 80,
	})
	if err != nil {
		t.Fatal(err)
	}
	manager.StopServer(1)
	if _, err := manager.State(first.TunnelID); err == nil {
		t.Fatal("server 1 tunnel still exists")
	}
	if _, err := manager.State(second.TunnelID); err != nil {
		t.Fatalf("server 2 tunnel was stopped: %v", err)
	}
	manager.StopAll()
}

func readBytes(t *testing.T, reader io.Reader, count int) []byte {
	t.Helper()
	buf := make([]byte, count)
	if conn, ok := reader.(net.Conn); ok {
		_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	}
	if _, err := io.ReadFull(reader, buf); err != nil {
		t.Fatal(err)
	}
	return buf
}

func freePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

func assertAccepts(t *testing.T, address string) {
	t.Helper()
	conn, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatalf("%s should accept connections: %v", address, err)
	}
	_ = conn.Close()
}

func assertRefused(t *testing.T, address string) {
	t.Helper()
	if conn, err := net.DialTimeout("tcp", address, 100*time.Millisecond); err == nil {
		_ = conn.Close()
		t.Fatalf("%s still accepts connections", address)
	}
}

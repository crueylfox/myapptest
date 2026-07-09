package tunnelmanager

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"hostdeck/internal/domain"
)

var errTunnelPortReleaseFailed = errors.New("端口转发停止失败，配置未删除，请先手动停止后再删除。")

func verifyTunnelPortReleased(state domain.TunnelRuntime, transport Transport) error {
	switch state.Type {
	case domain.TunnelTypeLocal, domain.TunnelTypeDynamic:
		return verifyLocalPortReleased(net.JoinHostPort(state.BindHost, strconv.Itoa(state.BindPort)))
	case domain.TunnelTypeRemote:
		return verifyRemotePortReleased(state.RemoteBindPort, transport)
	default:
		return nil
	}
}

func verifyLocalPortReleased(address string) error {
	if strings.TrimSpace(address) == "" {
		return nil
	}
	deadline := time.Now().Add(1200 * time.Millisecond)
	for {
		conn, err := net.DialTimeout("tcp", address, 80*time.Millisecond)
		if err != nil {
			return nil
		}
		_ = conn.Close()
		if time.Now().After(deadline) {
			return errTunnelPortReleaseFailed
		}
		time.Sleep(60 * time.Millisecond)
	}
}

func verifyRemotePortReleased(port int, transport Transport) error {
	if port <= 0 || transport == nil {
		return nil
	}
	deadline := time.Now().Add(1500 * time.Millisecond)
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
		output, err := transport.Run(ctx, remoteListenProbeCommand)
		cancel()
		if err == nil {
			if strings.Contains(output, "__SERVERPILOT_LISTEN_TOOL:missing") {
				return fmt.Errorf("%w 无法验证远程端口是否释放：服务器缺少 ss/netstat。", errTunnelPortReleaseFailed)
			}
			if len(listenHostsForPort(output, port)) == 0 {
				return nil
			}
		}
		if time.Now().After(deadline) {
			return errTunnelPortReleaseFailed
		}
		time.Sleep(80 * time.Millisecond)
	}
}

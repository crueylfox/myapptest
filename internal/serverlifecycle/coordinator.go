package serverlifecycle

type MonitorManager interface {
	Stop(connectionID int64)
}

type TerminalManager interface {
	StopConnection(connectionID int64)
}

type SFTPManager interface {
	Stop(connectionID int64)
}

type TunnelManager interface {
	StopServer(connectionID int64)
}

type DockerManager interface {
	StopServer(connectionID int64)
}

type ProcessManager interface {
	StopServer(connectionID int64)
}

type BatchCommandManager interface {
	StopServer(connectionID int64)
}

type ServiceManager interface {
	StopServer(connectionID int64)
}

type NetworkInspectionManager interface {
	StopServer(connectionID int64)
}

type StateTracker interface {
	BeginDisconnect(connectionID int64)
	CompleteDisconnect(connectionID int64)
}

// Coordinator is the single owner of a server-wide explicit disconnect.
// Future server-scoped resources must be added here.
type Coordinator struct {
	monitor  MonitorManager
	terminal TerminalManager
	sftp     SFTPManager
	tunnel   TunnelManager
	docker   DockerManager
	process  ProcessManager
	batch    BatchCommandManager
	service  ServiceManager
	network  NetworkInspectionManager
	states   StateTracker
}

func New(
	monitor MonitorManager,
	terminal TerminalManager,
	sftp SFTPManager,
	tunnel TunnelManager,
	docker DockerManager,
	process ProcessManager,
	batch BatchCommandManager,
	service ServiceManager,
	network NetworkInspectionManager,
	states StateTracker,
) *Coordinator {
	return &Coordinator{monitor: monitor, terminal: terminal, sftp: sftp, tunnel: tunnel, docker: docker, process: process, batch: batch, service: service, network: network, states: states}
}

func (c *Coordinator) Disconnect(connectionID int64) {
	if c.states != nil {
		c.states.BeginDisconnect(connectionID)
	}
	if c.monitor != nil {
		c.monitor.Stop(connectionID)
	}
	if c.terminal != nil {
		c.terminal.StopConnection(connectionID)
	}
	if c.sftp != nil {
		c.sftp.Stop(connectionID)
	}
	if c.tunnel != nil {
		c.tunnel.StopServer(connectionID)
	}
	if c.docker != nil {
		c.docker.StopServer(connectionID)
	}
	if c.process != nil {
		c.process.StopServer(connectionID)
	}
	if c.batch != nil {
		c.batch.StopServer(connectionID)
	}
	if c.service != nil {
		c.service.StopServer(connectionID)
	}
	if c.network != nil {
		c.network.StopServer(connectionID)
	}
	if c.states != nil {
		c.states.CompleteDisconnect(connectionID)
	}
}

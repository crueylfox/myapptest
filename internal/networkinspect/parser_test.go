package networkinspect

import (
	"strings"
	"testing"

	"serverpilot/internal/domain"
)

func TestParseSSSnapshotAggregatesListenersConnectionsAndBytes(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_LISTEN__",
		`tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=10,fd=3))`,
		`tcp LISTEN 0 128 [::]:22 [::]:* users:(("sshd",pid=10,fd=4))`,
		`udp UNCONN 0 0 127.0.0.53%lo:53 0.0.0.0:* users:(("systemd-resolve",pid=20,fd=13))`,
		"__SPNI_ESTABLISHED__",
		`ESTAB 0 0 192.168.1.10:22 203.0.113.9:55555 users:(("sshd",pid=10,fd=5))`,
		`	 cubic bytes_sent:100 bytes_received:50 bytes_acked:999`,
		"__SPNI_INTERFACES__",
		"IFACE\teth0\t192.168.1.10",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "eth0", "2026-06-22T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Strategy != "ss" || snapshot.TotalListeners != 3 || intValue(snapshot.TotalConnections) != 1 || intValue(snapshot.UniqueRemoteIPs) != 1 {
		t.Fatalf("snapshot summary = %+v", snapshot)
	}
	if !snapshot.ByteCountersAvailable {
		t.Fatal("expected byte counters to be available")
	}
	row := findEndpoint(t, snapshot.Listeners, "tcp", 22)
	if intValue(row.ConnectionCount) != 1 || intValue(row.UniqueRemoteIPCount) != 1 {
		t.Fatalf("row counts = %+v", row)
	}
	if row.UploadedBytes == nil || *row.UploadedBytes != 100 {
		t.Fatalf("uploaded bytes = %v", row.UploadedBytes)
	}
	if row.DownloadedBytes == nil || *row.DownloadedBytes != 50 {
		t.Fatalf("downloaded bytes = %v", row.DownloadedBytes)
	}
	if row.AggregationApproximate {
		t.Fatalf("pid-matched aggregation should not be approximate: %+v", row)
	}
}

func TestParseSSSnapshotAssociatesChildPIDConnectionWithWildcardListener(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_LISTEN__",
		`LISTEN 0 128 0.0.0.0:19405 0.0.0.0:* users:(("sshd",pid=1258,fd=3))`,
		"__SPNI_ESTABLISHED__",
		`ESTAB 0 0 192.168.0.203:19405 192.168.0.2:6564 users:(("sshd",pid=14121,fd=4))`,
		`     cubic wscale:7,7 rto:204 rtt:2.45/1.02 ato:40 mss:1448 bytes_sent:47616 bytes_received:5632 segs_out:99 segs_in:101`,
		"__SPNI_INTERFACES__",
		"IFACE\teth0\t192.168.0.203",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "eth0", "2026-06-22T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	row := findEndpoint(t, snapshot.Listeners, "tcp", 19405)
	if intValue(row.ConnectionCount) != 1 || intValue(row.UniqueRemoteIPCount) != 1 {
		t.Fatalf("expected ssh child process connection to aggregate into listener row: %+v", row)
	}
	if row.UploadedBytes == nil || *row.UploadedBytes != 47616 {
		t.Fatalf("uploaded bytes = %v", row.UploadedBytes)
	}
	if row.DownloadedBytes == nil || *row.DownloadedBytes != 5632 {
		t.Fatalf("downloaded bytes = %v", row.DownloadedBytes)
	}
	if !row.AggregationApproximate {
		t.Fatalf("pid-mismatched listener aggregation should be marked approximate: %+v", row)
	}
	if row.RowKind != "listener-and-connection" || !row.HasListener || !row.HasActiveConnections {
		t.Fatalf("row kind flags = %+v", row)
	}
}

func TestParseCentOSStateFilterWithoutStateColumnAndOldProcessOwner(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_TOOL__\tss\tsbin",
		"__SPNI_LISTEN__",
		`LISTEN 0 128 *:22 *:* users:(("sshd",1258,3))`,
		"__SPNI_STATUS__\tlistener\tok",
		"__SPNI_ESTABLISHED_FILTERED__",
		`0 0 192.168.0.203:22 192.168.0.2:53001 users:(("sshd",14121,4))`,
		"__SPNI_STATUS__\tconnection\tok-filtered",
		"__SPNI_ESTABLISHED_INFO_FILTERED__",
		`0 0 192.168.0.203:22 192.168.0.2:53001`,
		`     cubic wscale:7,7 bytes_sent:47616 bytes_received:104857600 segs_out:10 segs_in:20`,
		"__SPNI_STATUS__\tcounter\tok-filtered",
		"__SPNI_INTERFACES__",
		"IFACE\teth0\t192.168.0.203",
	}, "\n")

	snapshot, stats, err := ParseSnapshotWithStats(7, "ctx", output, "eth0", "now")
	if err != nil {
		t.Fatal(err)
	}
	if stats.SSPathKind != "sbin" || stats.SSDialect != "state-filter" {
		t.Fatalf("centos ss diagnostics = %+v", stats)
	}
	if !snapshot.ConnectionsAvailable || intValue(snapshot.TotalConnections) != 1 || intValue(snapshot.UniqueRemoteIPs) != 1 {
		t.Fatalf("snapshot summary = %+v", snapshot)
	}
	row := findEndpoint(t, snapshot.Listeners, "tcp", 22)
	if intValue(row.ConnectionCount) != 1 || intValue(row.UniqueRemoteIPCount) != 1 {
		t.Fatalf("centos ssh row counts = %+v", row)
	}
	if row.PID == nil || *row.PID != 1258 || row.ProcessName != "sshd" {
		t.Fatalf("listener owner = %+v", row)
	}
	if !row.AggregationApproximate {
		t.Fatalf("master/child pid association should be approximate: %+v", row)
	}
	if row.UploadedBytes == nil || *row.UploadedBytes != 47616 {
		t.Fatalf("server-perspective uploaded bytes = %v", row.UploadedBytes)
	}
	if row.DownloadedBytes == nil || *row.DownloadedBytes != 104857600 {
		t.Fatalf("server-perspective downloaded bytes = %v", row.DownloadedBytes)
	}
}

func TestParsePartialSnapshotConnectionFailureUsesNilCounts(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_LISTEN__",
		`tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=10,fd=3))`,
		"__SPNI_STATUS__\tlistener\tok",
		"__SPNI_ESTABLISHED_FILTERED__",
		"__SPNI_STATUS__\tconnection\tfailed",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.ListenersAvailable || snapshot.ConnectionsAvailable {
		t.Fatalf("availability = %+v", snapshot)
	}
	if snapshot.TotalConnections != nil || snapshot.UniqueRemoteIPs != nil {
		t.Fatalf("unavailable totals should be nil, got %+v", snapshot)
	}
	row := findEndpoint(t, snapshot.Listeners, "tcp", 22)
	if row.ConnectionCount != nil || row.UniqueRemoteIPCount != nil || row.UploadedBytes != nil || row.DownloadedBytes != nil {
		t.Fatalf("unavailable row fields should be nil: %+v", row)
	}
	if len(snapshot.Warnings) == 0 || snapshot.Warnings[0] != "已读取监听端口，但活动连接读取失败。" {
		t.Fatalf("warnings = %+v", snapshot.Warnings)
	}
}

func TestParseCounterFailureKeepsConnectionCounts(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_LISTEN__",
		`tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=10,fd=3))`,
		"__SPNI_STATUS__\tlistener\tok",
		"__SPNI_ESTABLISHED_FILTERED__",
		`0 0 192.168.0.203:22 192.168.0.2:53001`,
		"__SPNI_STATUS__\tconnection\tok-filtered",
		"__SPNI_ESTABLISHED_INFO_FILTERED__",
		"__SPNI_STATUS__\tcounter\tfailed",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.ConnectionsAvailable || intValue(snapshot.TotalConnections) != 1 || intValue(snapshot.UniqueRemoteIPs) != 1 {
		t.Fatalf("connection counts should remain available: %+v", snapshot)
	}
	row := findEndpoint(t, snapshot.Listeners, "tcp", 22)
	if intValue(row.ConnectionCount) != 1 || intValue(row.UniqueRemoteIPCount) != 1 {
		t.Fatalf("row counts = %+v", row)
	}
	if row.UploadedBytes != nil || row.DownloadedBytes != nil || row.ByteCountersAvailable {
		t.Fatalf("byte counters should be unavailable: %+v", row)
	}
	if len(snapshot.Warnings) == 0 || snapshot.Warnings[0] != "当前 CentOS/iproute2 未提供可靠的单连接字节统计。" {
		t.Fatalf("warnings = %+v", snapshot.Warnings)
	}
}

func TestParseSSBytesAckedProvidesEstimatedUploadFallback(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_LISTEN__",
		`tcp LISTEN 0 128 0.0.0.0:443 0.0.0.0:* users:(("nginx",pid=30,fd=3))`,
		"__SPNI_ESTABLISHED__",
		`ESTAB 0 0 10.0.0.2:443 198.51.100.3:50000 users:(("nginx",pid=30,fd=4))`,
		`	 cubic bytes_acked:2048`,
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	row := findEndpoint(t, snapshot.Listeners, "tcp", 443)
	if row.UploadedBytes != nil {
		t.Fatalf("bytes_acked must not be written into uploadedBytes: %+v", row)
	}
	if row.UploadedBytesEstimate == nil || *row.UploadedBytesEstimate != 2048 || !row.UploadedBytesEstimated {
		t.Fatalf("expected estimated upload from bytes_acked: %+v", row)
	}
	if row.DownloadedBytes != nil || !row.ByteCountersAvailable {
		t.Fatalf("unexpected download/counter state = %+v", row)
	}
	if !snapshot.ByteCountersAvailable || snapshot.SocketUploadBytesEstimatedCount != 1 || snapshot.SocketUploadBytesKnownCount != 0 {
		t.Fatalf("snapshot counter diagnostics = %+v", snapshot)
	}
	if len(snapshot.Warnings) == 0 || snapshot.Warnings[0] != "部分累计上传使用 bytes_acked 近似值。" {
		t.Fatalf("warnings = %+v", snapshot.Warnings)
	}
}

func TestParseRemoteSocketSummarySurvivesReturnedRowLimit(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_ROW_LIMIT__\t500",
		"__SPNI_SOCKET_SUMMARY__\t100000\t321\tok",
		"__SPNI_STRATEGY__ ss",
		"__SPNI_ESTABLISHED_FILTERED__",
		`0 0 192.168.1.10:45122 203.0.113.20:443 users:(("th_ecmanager",pid=2532,fd=8))`,
		"__SPNI_STATUS__\tconnection\tok-filtered",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if intValue(snapshot.TotalConnections) != 100000 || intValue(snapshot.SocketConnectionCount) != 100000 || intValue(snapshot.SocketRemoteIPCount) != 321 {
		t.Fatalf("socket summary should come from count-only marker: %+v", snapshot)
	}
	if !snapshot.Aggregated || snapshot.RowLimit != 500 || intValue(snapshot.RawConnectionCountBeforeLimit) != 100000 {
		t.Fatalf("limit metadata = %+v", snapshot)
	}
	if snapshot.ReturnedRowCount != 1 {
		t.Fatalf("returned rows = %d, rows=%+v", snapshot.ReturnedRowCount, snapshot.Listeners)
	}
	if !containsWarning(snapshot.Warnings, "前 500 项") {
		t.Fatalf("aggregation warning = %+v", snapshot.Warnings)
	}
}

func TestParseSocketSummaryIgnoresSelectedInterfaceForEndpointTable(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_SOCKET_SUMMARY__\t100\t10\tok",
		"__SPNI_SOCKET_LOCAL_SUMMARY__\t192.168.1.10\t40\t4",
		"__SPNI_STRATEGY__ ss",
		"__SPNI_ESTABLISHED_FILTERED__",
		`0 0 192.168.1.10:45122 203.0.113.20:443 users:(("app",pid=2532,fd=8))`,
		"__SPNI_STATUS__\tconnection\tok-filtered",
		"__SPNI_INTERFACES__",
		"IFACE\teth0\t192.168.1.10",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "eth0", "now")
	if err != nil {
		t.Fatal(err)
	}
	if intValue(snapshot.SocketConnectionCount) != 100 || intValue(snapshot.SocketRemoteIPCount) != 10 {
		t.Fatalf("socket summary should not be filtered by selected interface: %+v", snapshot)
	}
}

func TestParseConntrackSummaryIsIgnored(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_CONNTRACK_SUMMARY__\tnf_conntrack\t100123\t800\tok",
		"__SPNI_SOCKET_SUMMARY__\t32\t6\tok",
		"__SPNI_STRATEGY__ ss",
		"__SPNI_ESTABLISHED_FILTERED__",
		"__SPNI_STATUS__\tconnection\tok-filtered",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if intValue(snapshot.SocketConnectionCount) != 32 || snapshot.ConntrackConnectionCount != nil || snapshot.ConntrackRemoteIPCount != nil {
		t.Fatalf("summary counts = %+v", snapshot)
	}
	if snapshot.ConntrackAvailable || snapshot.ConntrackSource != "" {
		t.Fatalf("conntrack metadata = %+v", snapshot)
	}
	if len(snapshot.Listeners) != 0 {
		t.Fatalf("conntrack must not create endpoint rows: %+v", snapshot.Listeners)
	}
}

func TestParseDockerNamespaceSocketsAddsSourceAndSummary(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_ROW_LIMIT__\t500",
		"__SPNI_SOCKET_SUMMARY__\t2\t2\tok",
		"__SPNI_DOCKER_STATUS__\tavailable\tdocker",
		"__SPNI_DOCKER_STATUS__\tcontainers\t1",
		"__SPNI_DOCKER_CONTAINER__\tabcdef123456\tspeedtest",
		"__SPNI_DOCKER_SOCKET_SUMMARY__\t10000\t42\tok",
		"__SPNI_DOCKER_LISTEN__\tabcdef123456\tspeedtest",
		`tcp LISTEN 0 128 0.0.0.0:8080 0.0.0.0:* users:(("nginx",pid=20,fd=3))`,
		"__SPNI_DOCKER_ESTABLISHED_FILTERED__\tabcdef123456\tspeedtest",
		`0 0 172.17.0.2:8080 198.51.100.1:50000 users:(("nginx",pid=21,fd=4))`,
		"__SPNI_DOCKER_ESTABLISHED_INFO_FILTERED__\tabcdef123456\tspeedtest",
		`0 0 172.17.0.2:8080 198.51.100.1:50000`,
		`     cubic bytes_sent:1234 bytes_received:5678`,
		"__SPNI_STATUS__\tcounter\tok-filtered",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.DockerAvailable || !snapshot.DockerNamespaceAvailable || snapshot.DockerContainerCount != 1 ||
		snapshot.DockerScannedContainerCount != 1 {
		t.Fatalf("docker metadata = %+v", snapshot)
	}
	if intValue(snapshot.HostSocketConnectionCount) != 2 ||
		intValue(snapshot.DockerSocketConnectionCount) != 10000 ||
		intValue(snapshot.TotalSocketConnectionCount) != 10002 ||
		intValue(snapshot.TotalRemoteIPCount) != 44 {
		t.Fatalf("docker summary counts = %+v", snapshot)
	}
	row := findEndpoint(t, snapshot.Listeners, "tcp", 8080)
	if row.SourceType != "docker" || row.ContainerName != "speedtest" || row.SourceName != "speedtest" {
		t.Fatalf("docker row source = %+v", row)
	}
	if intValue(row.ConnectionCount) != 1 || intValue(row.UniqueRemoteIPCount) != 1 {
		t.Fatalf("docker row aggregation = %+v", row)
	}
	if row.UploadedBytes == nil || *row.UploadedBytes != 1234 || row.DownloadedBytes == nil || *row.DownloadedBytes != 5678 {
		t.Fatalf("docker row bytes = %+v", row)
	}
	if !snapshot.DockerAggregated || !containsWarning(snapshot.Warnings, "Docker") {
		t.Fatalf("expected docker aggregation warning = %+v", snapshot.Warnings)
	}
}

func TestParseDockerProcFallbackKeepsConnectionCounts(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_DOCKER_STATUS__\tnsenter-missing\tnsenter",
		"__SPNI_DOCKER_CONTAINER__\tdef123456789\tapi",
		"__SPNI_DOCKER_SOCKET_SUMMARY__\t2\t2\tok",
		"__SPNI_DOCKER_PROC__\tdef123456789\tapi",
		"DOCKER_PROC_SOCKET\ttcp\t020011AC:1F90\t00000000:0000\t0A\t11",
		"DOCKER_PROC_SOCKET\ttcp\t020011AC:1F90\t017100CB:C350\t01\t12",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if intValue(snapshot.DockerSocketConnectionCount) != 2 || intValue(snapshot.DockerRemoteIPCount) != 2 {
		t.Fatalf("docker proc summary = %+v", snapshot)
	}
	row := findEndpoint(t, snapshot.Listeners, "tcp", 8080)
	if row.SourceType != "docker" || row.ProcessName != "api" || intValue(row.ConnectionCount) != 1 {
		t.Fatalf("docker proc row = %+v", row)
	}
	if row.UploadedBytes != nil || row.DownloadedBytes != nil || row.ByteCountersAvailable {
		t.Fatalf("proc fallback must not fake socket bytes: %+v", row)
	}
}

func TestParseDockerEmptyContainerSummaryShowsZero(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_DOCKER_STATUS__\tavailable\tempty",
		"__SPNI_DOCKER_STATUS__\tcontainers\t0",
		"__SPNI_DOCKER_SOCKET_SUMMARY__\t0\t0\tok",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.DockerAvailable || !snapshot.DockerNamespaceAvailable || snapshot.DockerContainerCount != 0 {
		t.Fatalf("docker availability = %+v", snapshot)
	}
	if intValue(snapshot.DockerSocketConnectionCount) != 0 || intValue(snapshot.DockerRemoteIPCount) != 0 {
		t.Fatalf("empty docker containers should be a real zero summary: %+v", snapshot)
	}
}

func TestParseDockerEndpointSummaryAggregatesLargeProcessRows(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_ROW_LIMIT__\t500",
		"__SPNI_DOCKER_CONTAINER__\tabcdef123456\tspeedtest",
		"__SPNI_DOCKER_SOCKET_SUMMARY__\t10000\t42\tok",
		"__SPNI_DOCKER_ENDPOINT_SUMMARY__\tabcdef123456\tspeedtest\ttcp\tiperf3\t10000\t42",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Listeners) != 1 {
		t.Fatalf("expected one docker aggregate row: %+v", snapshot.Listeners)
	}
	row := snapshot.Listeners[0]
	if row.SourceType != "docker" || row.ContainerName != "speedtest" || row.ProcessName != "iperf3" {
		t.Fatalf("docker aggregate source = %+v", row)
	}
	if intValue(row.ConnectionCount) != 10000 || intValue(row.UniqueRemoteIPCount) != 42 {
		t.Fatalf("docker aggregate counts = %+v", row)
	}
	if row.UploadedBytes != nil || row.DownloadedBytes != nil || row.ByteCountersAvailable {
		t.Fatalf("docker aggregate must not fake socket bytes: %+v", row)
	}
}

func TestDockerAndHostSamePortDoNotMix(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_LISTEN__",
		`tcp LISTEN 0 128 0.0.0.0:8080 0.0.0.0:* users:(("host-nginx",pid=10,fd=3))`,
		"__SPNI_STATUS__\tlistener\tok",
		"__SPNI_DOCKER_CONTAINER__\tabcdef123456\tweb",
		"__SPNI_DOCKER_SOCKET_SUMMARY__\t1\t1\tok",
		"__SPNI_DOCKER_ESTABLISHED_FILTERED__\tabcdef123456\tweb",
		`0 0 172.17.0.2:8080 198.51.100.1:50000 users:(("nginx",pid=21,fd=4))`,
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	var hostRow, dockerRow *domain.NetworkEndpointSummary
	for i := range snapshot.Listeners {
		if snapshot.Listeners[i].ListenPort == 8080 && snapshot.Listeners[i].SourceType == "host" {
			hostRow = &snapshot.Listeners[i]
		}
		if snapshot.Listeners[i].SourceType == "docker" {
			dockerRow = &snapshot.Listeners[i]
		}
	}
	if hostRow == nil || dockerRow == nil {
		t.Fatalf("expected separate host and docker rows: %+v", snapshot.Listeners)
	}
	if intValue(hostRow.ConnectionCount) != 0 || intValue(dockerRow.ConnectionCount) != 1 {
		t.Fatalf("namespace connections mixed: host=%+v docker=%+v", hostRow, dockerRow)
	}
}

func TestParseOutboundOnlyConnectionsAggregateByProcessAndProtocol(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_ESTABLISHED_FILTERED__",
		`0 0 192.168.1.10:45122 203.0.113.20:443 users:(("th_ecmanager",pid=2532,fd=8))`,
		`     cubic bytes_sent:200 bytes_received:100`,
		`0 0 192.168.1.10:45123 203.0.113.21:443 users:(("th_ecmanager",pid=2533,fd=8))`,
		`     cubic bytes_sent:400 bytes_received:300`,
		`0 0 192.168.1.10:45124 203.0.113.20:443 users:(("th_ecmanager",pid=2533,fd=9))`,
		`     cubic bytes_sent:600 bytes_received:500`,
		"__SPNI_STATUS__\tconnection\tok-filtered",
		"__SPNI_STATUS__\tcounter\tok-filtered",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Listeners) != 1 {
		t.Fatalf("expected one aggregated outbound row: %+v", snapshot.Listeners)
	}
	row := snapshot.Listeners[0]
	if row.ProcessName != "th_ecmanager" || row.PID != nil || row.PIDLabel != "多个" || intValue(row.AggregatedProcessCount) != 2 {
		t.Fatalf("process aggregation = %+v", row)
	}
	if intValue(row.ConnectionCount) != 3 || intValue(row.UniqueRemoteIPCount) != 2 {
		t.Fatalf("connection aggregation = %+v", row)
	}
	if row.UploadedBytes == nil || *row.UploadedBytes != 1200 || row.UploadedBytesEstimate != nil || row.UploadedBytesEstimated {
		t.Fatalf("upload aggregation = %+v", row)
	}
	if row.DownloadedBytes == nil || *row.DownloadedBytes != 900 {
		t.Fatalf("download aggregation = %+v", row)
	}
}

func TestParsePermissionLimitedOutboundConnectionsAggregate(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_ESTABLISHED_FILTERED__",
		`0 0 192.168.1.10:45122 203.0.113.20:443`,
		`     cubic bytes_received:100 bytes_acked:200`,
		`0 0 192.168.1.10:45123 203.0.113.21:443`,
		`     cubic bytes_received:300 bytes_acked:400`,
		`0 0 192.168.1.10:45124 203.0.113.20:443`,
		`     cubic bytes_received:500 bytes_acked:600`,
		"__SPNI_STATUS__\tconnection\tok-filtered",
		"__SPNI_STATUS__\tcounter\tok-filtered",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Listeners) != 1 {
		t.Fatalf("permission-limited outbound rows should aggregate: %+v", snapshot.Listeners)
	}
	row := snapshot.Listeners[0]
	if row.ProcessName != "" || row.PID != nil || row.PIDLabel != "" || !row.PermissionLimited {
		t.Fatalf("permission-limited row identity = %+v", row)
	}
	if intValue(row.ConnectionCount) != 3 || intValue(row.UniqueRemoteIPCount) != 2 {
		t.Fatalf("permission-limited aggregation = %+v", row)
	}
	if row.UploadedBytes != nil || row.UploadedBytesEstimate == nil || *row.UploadedBytesEstimate != 1200 || !row.UploadedBytesEstimated {
		t.Fatalf("permission-limited upload estimate = %+v", row)
	}
	if row.DownloadedBytes == nil || *row.DownloadedBytes != 900 {
		t.Fatalf("permission-limited download = %+v", row)
	}
}

func TestParseSSPermissionLimitedAndReusePort(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_LISTEN__",
		`tcp LISTEN 0 128 0.0.0.0:8080 0.0.0.0:*`,
		`tcp LISTEN 0 128 0.0.0.0:8081 0.0.0.0:* users:(("app",pid=41,fd=3),("app",pid=42,fd=3))`,
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.PermissionLimited {
		t.Fatal("missing process info should mark permission limited")
	}
	if snapshot.TotalListeners != 3 {
		t.Fatalf("expected one permission-limited row plus two reuseport rows, got %d: %+v", snapshot.TotalListeners, snapshot.Listeners)
	}
}

func TestParseNetstatFallback(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ netstat",
		"__SPNI_NETSTAT_LISTEN__",
		"Proto Recv-Q Send-Q Local Address Foreign Address State PID/Program name",
		"tcp 0 0 0.0.0.0:80 0.0.0.0:* LISTEN 123/nginx",
		"tcp6 0 0 :::22 :::* LISTEN -",
		"udp 0 0 0.0.0.0:68 0.0.0.0:* 456/dhclient",
		"__SPNI_NETSTAT_ESTABLISHED__",
		"Proto Recv-Q Send-Q Local Address Foreign Address State PID/Program name",
		"tcp 0 0 192.168.1.10:80 198.51.100.3:51112 ESTABLISHED 456/nginx",
	}, "\n")

	snapshot, err := ParseSnapshot(9, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Strategy != "netstat" || snapshot.TotalListeners != 3 || intValue(snapshot.TotalConnections) != 1 || intValue(snapshot.UniqueRemoteIPs) != 1 {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	if row := findEndpoint(t, snapshot.Listeners, "tcp", 80); row.ProcessName != "nginx" || row.PID == nil || *row.PID != 123 || intValue(row.ConnectionCount) != 1 {
		t.Fatalf("nginx row = %+v", row)
	}
	if row := findEndpoint(t, snapshot.Listeners, "tcp6", 22); !row.PermissionLimited {
		t.Fatalf("missing pid should be permission-limited: %+v", row)
	}
}

func TestParseSSAddsOutboundOnlyRows(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_LISTEN__",
		`tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=10,fd=3))`,
		"__SPNI_ESTABLISHED__",
		`ESTAB 0 0 192.168.1.10:45122 203.0.113.20:443 users:(("ecmanager",pid=2532,fd=8))`,
		`     cubic bytes_sent:900 bytes_received:1200`,
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.TotalListeners != 1 || intValue(snapshot.TotalConnections) != 1 || len(snapshot.Listeners) != 2 {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	var outbound *domain.NetworkEndpointSummary
	for i := range snapshot.Listeners {
		if snapshot.Listeners[i].RowKind == "connection" {
			outbound = &snapshot.Listeners[i]
			break
		}
	}
	if outbound == nil {
		t.Fatalf("missing outbound-only row: %+v", snapshot.Listeners)
	}
	if outbound.ListenAddress != "—" || outbound.ListenPort != 0 || intValue(outbound.ConnectionCount) != 1 || intValue(outbound.UniqueRemoteIPCount) != 1 {
		t.Fatalf("outbound row = %+v", outbound)
	}
	if outbound.UploadedBytes == nil || *outbound.UploadedBytes != 900 || outbound.DownloadedBytes == nil || *outbound.DownloadedBytes != 1200 {
		t.Fatalf("outbound bytes = %+v", outbound)
	}
	if outbound.HasListener || !outbound.HasActiveConnections {
		t.Fatalf("outbound flags = %+v", outbound)
	}
}

func TestParseProcFallbackMapsInodeOwnersAndIPv6(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ proc",
		"__SPNI_PROC__",
		"PROC_SOCKET\ttcp\t0100007F:0050\t00000000:0000\t0A\t800",
		"PROC_SOCKET\ttcp\t0100007F:0050\t090071CB:D903\t01\t801",
		"PROC_SOCKET\ttcp6\t00000000000000000000000000000000:0016\t00000000000000000000000000000000:0000\t0A\t900",
		"PROC_OWNER\t800\t321\tnginx",
		"PROC_OWNER\t801\t321\tnginx",
		"PROC_OWNER\t900\t22\tsshd",
	}, "\n")

	snapshot, err := ParseSnapshot(9, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Strategy != "proc" || snapshot.TotalListeners != 2 || intValue(snapshot.TotalConnections) != 1 {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	row := findEndpoint(t, snapshot.Listeners, "tcp", 80)
	if row.ListenAddress != "127.0.0.1" || row.ProcessName != "nginx" || intValue(row.ConnectionCount) != 1 || intValue(row.UniqueRemoteIPCount) != 1 {
		t.Fatalf("proc tcp row = %+v", row)
	}
	if row := findEndpoint(t, snapshot.Listeners, "tcp6", 22); row.ListenAddress != "::" {
		t.Fatalf("proc tcp6 row = %+v", row)
	}
}

func TestNetworkInspectCommandDoesNotReadCmdlineOrEnviron(t *testing.T) {
	if strings.Contains(snapshotCommand, "/cmdline") || strings.Contains(snapshotCommand, "/environ") {
		t.Fatalf("network inspection command must not read cmdline/environ:\n%s", snapshotCommand)
	}
	if !strings.Contains(snapshotCommand, `head -n "$row_limit"`) {
		t.Fatalf("snapshot command should limit raw socket rows: %s", snapshotCommand)
	}
	if !strings.Contains(snapshotCommand, "/usr/sbin/ss") || !strings.Contains(snapshotCommand, "/sbin/ss") {
		t.Fatalf("snapshot command should search fixed sbin paths for ss: %s", snapshotCommand)
	}
	if !strings.Contains(snapshotCommand, `"$ss_bin" -H -lntup`) ||
		!strings.Contains(snapshotCommand, `"$netstat_bin" -lntup`) ||
		!strings.Contains(snapshotCommand, "__SPNI_LISTEN__") ||
		!strings.Contains(snapshotCommand, "__SPNI_NETSTAT_LISTEN__") {
		t.Fatalf("snapshot command should collect listener rows through ss/netstat: %s", snapshotCommand)
	}
	if !strings.Contains(snapshotCommand, "find_tool docker") ||
		!strings.Contains(snapshotCommand, "ps --no-trunc") ||
		!strings.Contains(snapshotCommand, "docker_ps_status") ||
		!strings.Contains(snapshotCommand, "inspect --format") ||
		!strings.Contains(snapshotCommand, "NetworkSettings.Networks") ||
		!strings.Contains(snapshotCommand, "nsenter") ||
		!strings.Contains(snapshotCommand, "/proc/$init_pid/ns/net") ||
		!strings.Contains(snapshotCommand, "seen_netns") ||
		!strings.Contains(snapshotCommand, "container:*") ||
		!strings.Contains(snapshotCommand, "/proc/$pid/net/tcp") ||
		!strings.Contains(snapshotCommand, "__SPNI_DOCKER_LISTEN__") {
		t.Fatalf("snapshot command should collect docker listener namespaces safely: %s", snapshotCommand)
	}
	for _, required := range []string{
		"state established",
		"__SPNI_ESTABLISHED",
		"__SPNI_SOCKET_SUMMARY__",
		"__SPNI_DOCKER_SOCKET_SUMMARY__",
		"__SPNI_DOCKER_ENDPOINT_SUMMARY__",
		"__SPNI_DOCKER_ESTABLISHED_FILTERED__",
		"__SPNI_DOCKER_ESTABLISHED_INFO_FILTERED__",
	} {
		if !strings.Contains(snapshotCommand, required) {
			t.Fatalf("snapshot command should collect active/counter metrics %q:\n%s", required, snapshotCommand)
		}
	}
	for _, forbidden := range []string{
		"__SPNI_CONNTRACK_SUMMARY__",
		"/proc/net/nf_conntrack",
		"bytes_acked",
	} {
		if strings.Contains(snapshotCommand, forbidden) {
			t.Fatalf("snapshot command should not collect conntrack or estimated byte metrics %q:\n%s", forbidden, snapshotCommand)
		}
	}
	if strings.Contains(snapshotCommand, "docker exec") || strings.Contains(snapshotCommand, "sudo -S") {
		t.Fatalf("snapshot command must not use docker exec or sudo password prompts: %s", snapshotCommand)
	}
}

func TestNetworkInspectHostScopeCommandSkipsDockerCollection(t *testing.T) {
	command := snapshotCommandForScope("host")
	for _, forbidden := range []string{
		"emit_docker_snapshot",
		"find_tool docker",
		"ps --no-trunc",
		"inspect --format",
		"NetworkSettings.Networks",
		"nsenter",
		"__SPNI_DOCKER_LISTEN__",
		"__SPNI_DOCKER_ESTABLISHED_FILTERED__",
		"__SPNI_DOCKER_ESTABLISHED_INFO_FILTERED__",
	} {
		if strings.Contains(command, forbidden) {
			t.Fatalf("host scope command should not collect docker data %q:\n%s", forbidden, command)
		}
	}
	for _, required := range []string{
		"__SPNI_LISTEN__",
		"__SPNI_ESTABLISHED",
		"__SPNI_SOCKET_SUMMARY__",
		"__SPNI_ESTABLISHED_INFO_FILTERED__",
	} {
		if !strings.Contains(command, required) {
			t.Fatalf("host scope command should still collect host metrics %q:\n%s", required, command)
		}
	}
	if snapshotCommandForScope("") != snapshotCommand || snapshotCommandForScope("full") != snapshotCommand {
		t.Fatal("empty and full scope should preserve the existing full snapshot command")
	}
}

func TestParseListenerOnlySnapshotDoesNotWarnAboutConnections(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_LISTEN__",
		`tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=10,fd=3))`,
		"__SPNI_STATUS__\tlistener\tok-process",
		"__SPNI_STATUS__\tprocess\tok-listener",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.ListenersAvailable || snapshot.ConnectionsAvailable {
		t.Fatalf("listener-only availability = %+v", snapshot)
	}
	if snapshot.TotalConnections != nil || snapshot.UniqueRemoteIPs != nil {
		t.Fatalf("connection totals should be unavailable: %+v", snapshot)
	}
	if len(snapshot.Warnings) != 0 {
		t.Fatalf("listener-only snapshot should not warn about skipped active metrics: %+v", snapshot.Warnings)
	}
	row := findEndpoint(t, snapshot.Listeners, "tcp", 22)
	if row.ConnectionCount != nil || row.UniqueRemoteIPCount != nil || row.UploadedBytes != nil || row.DownloadedBytes != nil {
		t.Fatalf("listener-only row should not include active metrics: %+v", row)
	}
}

func TestInterfaceSelectionDoesNotFilterEndpointRows(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_LISTEN__",
		`tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=10,fd=3))`,
		`tcp LISTEN 0 128 127.0.0.1:53 0.0.0.0:* users:(("dns",pid=11,fd=3))`,
		`tcp LISTEN 0 128 192.168.1.10:80 0.0.0.0:* users:(("nginx",pid=12,fd=3))`,
		"__SPNI_ESTABLISHED__",
		`ESTAB 0 0 192.168.1.10:80 198.51.100.1:50000 users:(("nginx",pid=12,fd=4))`,
		"__SPNI_INTERFACES__",
		"IFACE\teth0\t192.168.1.10",
		"IFACE\tlo\t127.0.0.1",
	}, "\n")

	snapshot, err := ParseSnapshot(7, "ctx", output, "eth0", "now")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.TotalListeners != 3 {
		t.Fatalf("interface selection should not filter listeners = %+v", snapshot.Listeners)
	}
	findEndpoint(t, snapshot.Listeners, "tcp", 22)
	findEndpoint(t, snapshot.Listeners, "tcp", 53)
	row := findEndpoint(t, snapshot.Listeners, "tcp", 80)
	if intValue(row.ConnectionCount) != 1 {
		t.Fatalf("expected eth0 connection, got %+v", row)
	}
}

func TestMalformedSnapshotDoesNotPanic(t *testing.T) {
	output := strings.Join([]string{
		"__SPNI_STRATEGY__ ss",
		"__SPNI_LISTEN__",
		"__SPNI_STATUS__\tlistener\tok",
		"not enough",
		"tcp LISTEN nope",
		"__SPNI_ESTABLISHED__",
		"__SPNI_STATUS__\tconnection\tok",
		"ESTAB bad line",
		"__SPNI_PROC__",
		"PROC_SOCKET\tbad",
	}, "\n")
	snapshot, err := ParseSnapshot(1, "ctx", output, "", "now")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Listeners == nil || snapshot.TotalListeners != 0 {
		t.Fatalf("malformed snapshot = %+v", snapshot)
	}
}

func findEndpoint(t *testing.T, rows []domain.NetworkEndpointSummary, protocol string, port int) domain.NetworkEndpointSummary {
	t.Helper()
	for _, row := range rows {
		if row.Protocol == protocol && row.ListenPort == port {
			return row
		}
	}
	t.Fatalf("endpoint %s/%d not found in %+v", protocol, port, rows)
	return domain.NetworkEndpointSummary{}
}

func intValue(value *int) int {
	if value == nil {
		return -1
	}
	return *value
}

func containsWarning(warnings []string, text string) bool {
	for _, warning := range warnings {
		if strings.Contains(warning, text) {
			return true
		}
	}
	return false
}

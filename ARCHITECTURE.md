# Compatibility Entry

中文主文档: `架构说明.md`

---

# 架构说明

英文兼容入口：`ARCHITECTURE.md`。

本文件是架构冻结规则的中文主文档。架构规则优先级高于当前轮次状态、开发进展、项目交接和路线图。

## 架构硬约束摘要

- SSH / Terminal / Monitor / SFTP / SCP / Tunnel / Docker / Local Terminal runtime 必须相互隔离。
- `DisconnectServer(serverID)` 是服务器级关闭入口。
- 不能重构 workspace state model。
- 新功能必须作为 attachment layer 挂接到现有架构。
- 不允许为了功能重建 SSH runtime。
- Wails API 必须使用 typed struct，禁止 `map[string]interface{}` 作为 API contract。
- 不能让明文 secret 进入 SQLite / logs / frontend state / Wails events。
- Key Vault 可以在 SQLite 中保存 Windows 当前用户级保护后的私钥密文，但绝不能保存明文私钥或口令。
- `SecretStore` 仍是 password / passphrase 的敏感信息存储边界。

---

# ServerPilot Architecture

## 0. Architecture Freeze v1.0

The core architecture is frozen. Future development may only attach new
capabilities to the existing system; it must not rebuild the system structure.

Permanently frozen areas:

- SSH, Monitor, Terminal, and SFTP runtimes are independent.
- Workspace state model is independent from selected-server and terminal
  session state.
- `DisconnectServer(serverID)` is the single server-wide lifecycle shutdown
  entry.
- `SecretStore` is the platform boundary for passwords and passphrases.
- Key Vault may store private-key material only as platform-protected
  ciphertext plus metadata, never as plaintext.
- SQLite stores non-sensitive data plus the Key Vault protected-key ciphertext
  exception; it must not store plaintext secrets.

Allowed growth:

- Add capabilities to existing managers.
- Extend typed Wails APIs and existing event streams.
- Add fields to existing stores when needed.
- Add UI panels or settings sections.

Forbidden changes:

- Rewrite the SSH client or credential resolver.
- Merge Monitor, Terminal, and SFTP runtime sessions.
- Change the workspace state machine.
- Change `DisconnectServer(serverID)` semantics.
- Change the `SecretStore` or Key Vault security model.
- Let UI directly control SSH workers.
- Use `selectedServerID` as a runtime identity.
- Move SFTP into a right-side rail, drawer, or floating panel.

The only legal runtime isolation key is `serverID`; terminal streams also carry
`sessionID`. Events without the relevant identity are invalid for runtime
state changes.

## 0.1 Non-Sensitive Local Persistence

SQLite may store non-sensitive local UI/runtime summaries when they do not
change subsystem ownership or lifecycle semantics.

Current examples:

- `alert_history` stores alert event summaries, read state, resolved state,
  interrupted state, timestamps, rule type, severity, threshold/value, unit,
  session ID, and a server-name snapshot.
- `window_state` stores native window x/y/width/height, monitor identifier,
  maximized state, restore bounds, layout version, and updated time.

These tables are attachment-layer persistence. They must not drive SSH,
Monitor, SFTP, Tunnel, Docker, Process Manager, Service Manager, Network
Details, Network Diagnostics, Local Terminal, Command History, Favorites, or
Terminal Profile runtime ownership.

Alert evaluator active state, pending state, mute state, and live metric
samples remain process memory. Window defaults apply only when no valid saved
window state exists; saved user window state always wins over default sizing.

`alert_history` and `window_state` are not backup/export payloads.

## 1. System Boundaries

ServerPilot uses a layered architecture:

```text
Vue UI / Pinia stores
        |
Wails typed application API
        |
Application services
  |          |          |      |
Connections Monitoring Terminal Logs
  |          |          |      |
SSH transport Linux parsers PTY Structured logger
        |
Repositories / SecretStore
        |
Pure Go SQLite / platform secret adapters
```

The UI never parses Linux command output and never controls goroutines
directly. SSH transport does not know about Vue or database schemas. Parsers
are pure functions and remain independently testable.

## 2. Module Structure

```text
cmd/serverpilot/              optional future CLI entry points
internal/app/                 Wails lifecycle and typed API
internal/domain/              shared domain models and validation
internal/connectionerror/     structured SSH error classification
internal/connectionstate/     per-server runtime state coordination
internal/serverlifecycle/     atomic server-wide disconnect orchestration
internal/sshclient/           SSH dialing, authentication, command execution
internal/monitor/             monitor workers, sampling, history, reconnect
internal/terminal/            interactive terminal workers and event batching
internal/sftpmanager/         independent SFTP sessions and transfer queue
internal/linuxmonitor/        collection script and pure output parsers
internal/keyvault/            private-key validation, fingerprinting, and protected material
internal/persistence/         SQLite repositories and migrations
internal/secretstore/         SecretStore interface and runtime-only adapter
internal/settings/            typed global settings validation and caching
internal/logging/             structured in-memory and file logging
frontend/src/api/             typed Wails call wrappers
frontend/src/stores/          Pinia state
frontend/src/components/      presentation components
frontend/src/views/           dashboard, connections, and logs
```

## 2.1 Frontend Context And Workspace Model

The frontend keeps navigation identity separate from live SSH resources:

- `selectedServerID` is the highlighted server and the monitor-page source.
- `activeTerminalSessionID` identifies one real terminal tab.
- `activeWorkspaceServerID` identifies the server shown in the terminal
  workspace and drives the compact monitor sidebar, bottom SFTP panel, and
  right-side status bar.
- `Workspace` is a navigable server page and may exist without a live terminal.
- `TerminalSession` is one real interactive SSH transport.
- `MonitorSession` is the independent background monitoring transport.
- `ConnectionError` is the latest structured failure retained by a workspace.

Workspace states are `offline`, `connecting`, `connected`, `reconnecting`,
`failed`, and `disconnected`. A failed terminal worker is removed by the
backend, but its server workspace remains with the server ID, Chinese summary,
and structured technical detail. A healthy monitor update cannot erase that
terminal failure. A successful terminal event replaces the failed state.

Each server records its last active terminal session. Navigation resolves in
this order: last active terminal, another existing terminal, a
connecting/failed/disconnected workspace, active monitoring, then an offline
workspace. The visible workspace order is persisted in local storage. Closing
the active server selects the adjacent remaining workspace according to that
order rather than activation history.

Server picker input uses one idempotent `OpenOrActivateServer(serverID)` path:

- single click and double click have the same open/activate/connect result;
- non-repeated Enter uses the same path;
- "Open terminal" activates an existing tab before considering creation;
- "New terminal" always requests an additional terminal;
- "Disconnect" stops server resources but keeps a disconnected workspace;
- the main workspace `×`, "Close server workspace", and server deletion remove
  the workspace.

Browser `click` events run before `dblclick`. A per-server activation guard,
connecting-state check, and backend duplicate check make both events converge
on at most one SSH attempt. Runtime events update only their own keyed
workspace and never change the active page.

## 2.2 Main Workspace Layout

The terminal workspace is one two-row, three-column grid:

```text
columns: monitor sidebar | splitter/handle | right workspace
rows:    right-only tabs | right terminal/SFTP/status content
```

The compact monitor sidebar and its splitter span both rows, so monitoring
starts at the top of the application content. The workspace tab bar occupies
only the right column and never covers the monitor sidebar. The previous
in-content SP/ServerPilot brand block is removed; the native window title is
unchanged.

The compact sidebar is split vertically into system/process/network monitoring
and a scrollable mount list. Its system details are collapsed per active
server, CPU/memory/swap use CSS progress bars, TOP shows at most five real
processes, and network alone retains a compact history curve. Each mount is a
single row with capacity text over a clamped progress bar.

The right workspace is split into terminal, horizontal bottom SFTP panel, and a
fixed status bar. SFTP and the status bar are explicitly assigned to
right-workspace grid rows and cannot extend below the sidebar.

The SFTP expand/collapse handle lives inside the horizontal splitter between
the terminal and SFTP rows. Dragging the splitter adjusts SFTP height; clicking
the handle only toggles expansion. This mirrors the left monitor sidebar's
splitter handle and keeps panel controls out of the SFTP toolbar.

Sidebar width, collapse state, monitor-to-mount ratio, SFTP expansion state,
SFTP height, and workspace tab order are persisted in browser local storage.

SFTP is an independent SSH transport/session. SFTP subsystem initialization
failure is classified as SFTP-only state (`SFTP_UNSUPPORTED` or
`SFTP_REMOTE_CLOSED_DURING_INIT`) and must not mark terminal or monitor SSH
sessions disconnected.

Remote text editing is intentionally narrow: the backend exposes explicit
SFTP read/write text APIs, rejects directories, large files, binary-looking
content, and non-UTF-8 content, and sends file contents through Wails JSON only
for the open editor buffer. Contents are not logged, cached in local storage,
or written to SQLite.

Explorer drag/drop upload uses Wails v2 file-drop paths. The frontend receives
local absolute paths from the runtime and passes them into the existing SFTP
upload queue; it does not read browser `File` objects or serialize file
contents through the frontend.
The sidebar collapse control lives inside the vertical splitter. Pointer input
on the handle is stopped before the splitter drag handler, so a drag cannot
accidentally toggle collapse. All persisted numeric values distinguish a
missing key from zero and are clamped during drag. Every layout change
increments a terminal layout revision; `FitAddon.fit()` then publishes the
resulting rows and columns through `ResizeTerminal` without recreating the SSH
session or intentionally moving focus.

## 3. SSH Connection Model

Each server has a connection controller. A controller may own separate SSH
transports for these workloads:

- monitoring;
- one independent transport for each interactive terminal tab;
- one independent SFTP transport per server workspace.

Monitoring and terminal transports never share an `ssh.Client` or
`ssh.Session`. Each remote monitor command receives a fresh `ssh.Session` from
the monitor-owned client. Every terminal tab owns a separate SSH client, PTY,
interactive shell, input queue, and cancellation context. SFTP is owned by
`internal/sftpmanager.Manager`; it dials through the shared credential resolver
and host-key policy path but creates a separate SSH client and separate
`github.com/pkg/sftp.Client`.

Authentication material is resolved by one backend `credential.Resolver`
before monitoring, connection tests, terminals, or SFTP code can dial.
The resolver validates private-key encryption state and reads remembered
secrets from the platform `SecretStore`. "Save" is an explicit credential
write; "Save and connect" defers replacement until a successful SSH handshake,
so an unverified new password cannot destroy a still-valid saved credential.
Connection records contain only host, port, username, authentication type,
either a legacy local private-key path or a Key Vault entry ID, and opaque
credential references. Passwords, plaintext private-key bytes, and passphrases
are never returned to the frontend.

Key Vault supports two storage modes. `legacy_file_path` keeps the old
path-reference behavior for existing data until the user migrates it.
`encrypted_database` reads the selected private-key file once in the backend,
validates it, computes algorithm/fingerprint/key bits, protects the raw key
bytes with the platform `KeyMaterialProtector`, and stores only the protected
blob plus metadata in SQLite. On Windows the protector uses DPAPI Current User
scope, so the protected blob is bound to the Windows user that imported it.
Server profiles store only `key_vault_id`; multiple servers may reference the
same key ID without duplicating key material. During credential resolution the
protected blob is decrypted in backend memory, parsed into an SSH signer, and
passed through backend-only auth fields. The resolver does not create temporary
private-key files and does not depend on the original source file after import.
Saved Key Vault passphrases remain in `SecretStore` using
`ServerPilot/keyvault/<keyID>/passphrase`.

Deleting an in-use Key Vault entry is a Key Vault service operation, not a
server lifecycle operation. The frontend first asks the backend for a typed
delete preview; if the key is referenced, the user must confirm deletion and
automatic unbinding. The backend then re-queries current usage and, inside one
SQLite transaction, clears all matching server `key_vault_id` values and
deletes the key-vault row. Affected server records remain private-key /
key-vault configurations that require the user to select another key before a
future connection. Existing SSH terminal, monitor, SFTP, tunnel, Docker,
process, service, and network-detail sessions are not disconnected, and the
delete path must not call `DisconnectServer(serverID)`.

Host trust is separate from authentication and follows one global typed policy:
`ask`, `trust_on_first_use`, or `trusted_only`. TOFU may automatically save only
an unknown host's first observed SHA-256 fingerprint. Every policy rejects a
changed saved fingerprint. The dedicated trust action probes the current key,
shows saved and observed fingerprints, probes again before persistence, and
never accepts credentials as proof of host identity.

## 4. Goroutine Lifecycle

The application root owns a process context created during Wails startup and
cancelled during shutdown.

Each active monitor has:

- a child context and cancel function;
- one supervisor goroutine;
- an owned SSH client;
- a completion channel or wait group entry;
- immutable connection identity;
- a thread-safe latest snapshot and 60-sample history.

Starting an already-running monitor is rejected so concurrent UI actions cannot
create duplicate workers. Disconnect cancels the monitor context, closes the
SSH client to interrupt network I/O, and waits for the worker to exit.
Application shutdown cancels the root context, stops all monitors, closes
repositories and log sinks, and waits for owned goroutines.

No worker may use `context.Background()` as its lifetime context after startup.

Each terminal worker has a root child context, one SSH transport, one PTY
shell, and bounded input/output queues. Reader, writer, shell wait, and
short-interval event batching workers are stopped together. Closing a tab
cancels the context, closes the shell to interrupt network I/O, waits for all
owned goroutines, and then removes the session from the manager.

The main close button on a terminal server tab does not mean "close one shell".
It calls the single Wails `DisconnectServer(serverID)` lifecycle entry. The
`serverlifecycle.Coordinator` marks the server disconnecting, stops and waits
for its monitor worker, closes and waits for every terminal worker owned by
that server, stops the SFTP session and cancels that server's active transfers,
and finally publishes one disconnected state. The operation is idempotent and
server-scoped. The terminal context menu has a separate "close current terminal
only" action.

After explicit disconnect, `connectionstate.Tracker` seals that server
lifecycle. Late monitor, terminal, or SFTP events cannot restore online state. A new
explicit monitor, terminal, or SFTP connection calls `BeginConnect` to open a new
lifecycle generation.

## 5. Collection Flow

One remote POSIX shell script emits sections with explicit markers. It reads:

- `/proc/stat`;
- `/proc/meminfo`;
- the default route from `ip route show default`, then `/proc/net/route`;
- `/sys/class/net/<interface>/statistics/rx_bytes`;
- `/sys/class/net/<interface>/statistics/tx_bytes`;
- all rows from `df -P -B1`, with `df -P -k` fallback;
- the top process rows from validated `ps` output;
- `/proc/loadavg`;
- `/proc/uptime`;
- `/etc/os-release`;
- `uname`.

The monitor records local monotonic sample time. Each successful collection
command is timed with `time.Now` and `time.Since`; that real SSH command
round-trip becomes the current server latency. Failed samples and reconnecting
states mark latency unavailable immediately. No ICMP request, extra SSH
transport, or permanent latency goroutine is created.

Pure parsers produce a raw sample. A stateful calculator compares CPU and
network counters with the prior sample. The first sample, reconnect, counter
reset, or interface change creates a new baseline and marks the derived value
unavailable for that interval.

Each metric has its own availability and error field. A missing command or file
does not invalidate unrelated metrics.

The process collector first verifies that the GNU-style `ps -eo` form actually
returns numeric PID/CPU/memory columns. This is necessary because some
compatibility implementations return exit status zero while ignoring those
format fields. It falls back to `ps -A -o pid,pcpu,pmem,comm`. Process parsing
skips malformed or vanished rows, and process failure remains isolated from all
other metrics.

Mount parsing does not depend on localized headings. The UI sorts by mount
path and hides pseudo filesystems, Docker/containers overlay mounts, and
`/dev`, `/proc`, `/run`, and `/sys` descendants by default. "显示全部" reveals
the unfiltered parsed list.

## 6. Frontend and Backend Communication

Wails binds an `App` facade with explicit methods such as:

- `ListConnections()`;
- `SaveConnection(request)`;
- `SaveConnectionConfig(request)`;
- `DeleteSavedCredential(id)`;
- `ListKeyVaultEntries()`;
- `CreateKeyVaultEntry(request)` / `UpdateKeyVaultEntry(request)`;
- `DeleteKeyVaultEntry(request)` returning `DeleteKeyVaultEntryResponse`;
- `ValidatePrivateKeyFile(request)`;
- `UpdateKeyVaultPassphrase(id, passphrase)` / `DeleteKeyVaultPassphrase(id)`;
- `GetSettings()` / `SaveSettings(settings)`;
- `ProbeHostKey(id)` / `TrustHostKey(request)`;
- `DeleteConnection(id)`;
- `TestConnection(request)`;
- `Connect(request)`;
- `DisconnectServer(id)` (`Disconnect` remains a compatibility alias);
- `Reconnect(request)`;
- `GetMonitorSnapshot(id)`;
- `ListLogs(limit)`.
- `OpenTerminal(request)`;
- `WriteTerminal(request)`;
- `ResizeTerminal(request)`;
- `CloseTerminal(sessionId)`;
- `ReconnectTerminal(request)`.
- `OpenSftp(request)`;
- `CloseSftp(id)`;
- `GetSftpState(id)`;
- `ReadSftpDir(request)`;
- `SftpGoHome(id)` / `SftpGoParent(id)`;
- `SftpMkdir(request)` / `SftpRename(request)` / `SftpDelete(request)`;
- `SftpUpload(request)` / `SftpDownload(request)`;
- `SftpCancelTransfer(request)`;
- `SelectLocalUploadFiles()` / `SelectLocalDownloadDirectory()`.

Request and response structs use JSON tags and stable scalar fields. Monitoring
and terminal output/status updates are delivered through Wails events. Terminal
bytes are base64 encoded so the Wails JSON boundary does not corrupt arbitrary
UTF-8 or ANSI sequences. Output is batched before crossing that boundary.
Pinia stores own UI state and cap monitor history to the most recent 60 seconds.
The SFTP store keys connection state, directory entries, selected paths, and
transfer records by `serverID` or `transferID`. It is bound to
`activeWorkspaceServerID`, so switching workspaces immediately switches to that
server's cached SFTP state. Wails events `sftp:state`, `sftp:entries`,
`sftp:transfer`, and `sftp:error` all carry the affected server ID; transfer
events also carry a transfer ID.

### SFTP File And Transfer Flow

Opening SFTP resolves credentials through `credential.Resolver`, applies the
configured host-key policy, dials a new SSH client with the configured timeout,
creates a `github.com/pkg/sftp.Client`, records the remote home directory, and
loads real remote entries on demand. If an encrypted Key Vault private key has
a saved passphrase, the resolver reads it from `SecretStore`; otherwise the
existing authentication dialog supplies a temporary passphrase. SFTP never
stores its own copy of passwords or passphrases.

Remote paths use POSIX semantics from Go's `path` package. Local upload and
download paths use `filepath`. Uploads and downloads stream through a fixed
buffer and progress callback; file contents do not cross the Wails JSON
boundary. Each server has one SFTP transfer slot, so transfers for that server
run sequentially while transfers for other servers remain isolated. Queued and
running transfers can be canceled. Conflict policies supported in this phase
are ask, overwrite, skip, and automatic rename using `file (1).ext` style
names.

This phase supports browsing, refresh, parent/home navigation, manual path
entry, create folder, same-directory rename, deleting files and empty
directories, multi-file upload, multi-file download, progress, cancel, and
clearing finished transfer records. Recursive directory transfer, pause and
resume, and platform file reveal are deferred.

After an SSH terminal is opened successfully, the frontend schedules
`autoOpenSftpForServer(connection, auth)` without awaiting it on the terminal
display path. The automatic open reuses the same transient `AuthRequest` when
the terminal connection just used a password, private-key passphrase, or
one-time host trust. If no transient authentication context exists, it queries
the existing authentication-state API and opens SFTP only when the
`CredentialResolver` can proceed silently, including saved passwords and saved
Key Vault passphrases. If a passphrase or password is still required, the SFTP
state is marked as needing credentials and the terminal remains online. The
frontend and backend both treat SFTP `online` and `connecting` as idempotent
no-op states, so double-clicks, tab switching, and refreshes cannot create
duplicate SFTP sessions.

The bottom SFTP panel keeps one compact toolbar row in expanded mode. The
toolbar starts with the Home action and carries file actions, conflict policy,
a low-priority More menu, and a refresh button pinned to the far right. It does
not show the SFTP title, server name, or connection-status summary; those
belong to the right-side status bar and disconnected/error content states.
Connect and Disconnect are intentionally absent from the normal toolbar; retry
appears only inside the disconnected/error content state. The path bar remains
a second row so remote paths do not crowd the action toolbar.

The file table prepends a synthetic `..` row whenever the current remote path
is not `/` or `.`. This row is never returned by the backend, never participates
in sorting or selection, and cannot be downloaded, renamed, deleted, or used in
conflict detection. Double-clicking it calls the same parent-directory business
method as the toolbar/menu action. At the remote root, no actionable `..` row
is shown.

SFTP context menus use the same app-level context-menu component as the rest
of the UI. File menus expose download, rename, delete, copy path/name, refresh,
and properties. Directory menus expose open, rename, delete empty directory,
copy path/name, refresh, and properties. Blank-area menus expose refresh, Home,
new folder, upload, hidden-file toggle, and copy current path. Multi-select
menus expose download selected, delete selected, copy remote paths, properties,
and refresh. The synthetic `..` parent row only exposes parent navigation. The
properties action selects or preserves the target selection, expands the
right-side details panel, clamps a missing or invalid persisted details width
back into the supported range, and does not enter directories, open editors,
download files, refresh the directory, or fetch file contents. Dangerous
operations still use the application confirmation modal and do not call browser
`prompt`, `alert`, or `confirm`.

The full transfer queue no longer consumes SFTP panel height. The right-side
status bar owns a transfer region that shows only the latest transfer for the
active workspace server. Clicking that region opens a popover with current
server or all-server filtering, progress, speed, status, cancel for queued or
running transfers, and clear-finished for completed, failed, canceled, or
skipped records. Transfer events remain keyed by server ID and transfer ID, so
late events cannot pollute another server's status bar.

The SFTP content area is split into a file table and a right-side details
panel. The details panel is collapsible, width-limited, draggable between 240
and 320 px, and persisted in local storage. It displays only metadata already
present in the SFTP entry list: name, type, size, permissions, owner, group,
modified time, and remote path. It does not fetch or preview file contents.

Frontend context is deliberately split:

- `selectedServerID` is the server-menu/configuration selection and drives the
  full monitor dashboard and server configuration actions;
- `activeTerminalSessionID` identifies the active terminal tab;
- `activeServerID` is derived from the active terminal session and drives only
  the terminal status bar;
- `terminalSessionsByServerID` groups terminal resources for close semantics;
- `monitorStateByServerID` caches snapshots and history by server;
- `connectionStateByServerID` tracks monitor, terminal, connecting, and error
  state by server.

Switching tabs reads the new server snapshot synchronously from the keyed
cache. It never waits for another network event and never uses the selected
server as a fallback. With no active terminal, every status-bar metric is
unavailable. Explicitly closed server IDs are suppressed in the frontend until
a new connection attempt, so late events cannot repopulate stale metrics.

Secrets are accepted only by connect/test requests and are omitted from all
response types.

Custom Vue context menus provide server, terminal-tab, and terminal-content
actions. They close on outside pointer input, Escape, or window blur and clamp
to the visible viewport. Transient success, information, and error messages use
a single overlay Toast so they do not reserve dashboard layout height.

The permanent server tree is removed from the main workspace. The top `+`
menu owns search, groups, server status, add server, and add group entry points.
It is anchored to the real `+` element, recalculates on resize and scroll, and
closes on outside `pointerdown`, Escape, or window blur. The `+` remains a flex
item directly after the final visible tab. The compact top navigation switches
among SSH workspace, full monitoring, logs, and settings.

Server workspace groups can be reordered with native HTML drag events. Dragging
changes only `workspaceOrder`; it never changes the active server, recreates a
terminal, or reconnects SSH. The insertion edge is rendered on the target tab,
and the order is stored under `serverpilot.workspaceTabOrder`.

Application overlays use one shared layering contract:

```text
page < popover < context menu < toast < modal < danger modal < busy
```

The values are CSS custom properties rather than component-specific escalating
integers. `AppDialogHost` provides typed input, normal confirmation, and danger
confirmation dialogs. It trims input, validates before submission, prevents
duplicate asynchronous submission, supports Enter/Escape, and restores focus.
No frontend production path calls browser `prompt`, `alert`, or `confirm`.

## 7. Error Handling

Backend SSH failures are represented as `ConnectionError` values with a stable
code, Chinese user message, technical message, retryability, server ID,
operation, and UTC timestamp. Classification covers authentication, private-key
and passphrase failures, DNS, timeout, refused and unreachable networks, host
key mismatch, handshake failure, remote close, cancellation, and unknown
errors. Detailed structured logs may include server name, server ID, operation,
error code, and technical detail, but never secret values or complete
private-key content.

`connectionstate.Tracker` tracks monitor, terminal, and SFTP activity
separately from the selected server configuration. A historical error therefore
cannot masquerade as an active session. Frontend menus enable Disconnect only
when `HasActiveSession` is true. Terminal, monitor, and SFTP events feed the same
runtime state stream through the `connection:state` Wails event.

The UI shows actionable status without exposing stack traces. Partial metric
errors appear on the affected card and remain available in the application log.

## 8. Reconnection Strategy

Manual connect starts immediately. Unexpected disconnects transition through:

```text
online -> reconnecting -> online
                    \-> offline after cancellation
```

Automatic retries apply only to retryable transport failures and use
exponential backoff with jitter, initially 1 second, doubling to a 30-second
cap. Authentication, passphrase, private-key, and host-key failures stop the
worker immediately and leave no active session. A successful sample resets the
retry counter. Cancellation interrupts both connection attempts and backoff
waits. Explicit disconnect disables automatic reconnect until the user
connects again.

## 9. Persistence

SQLite stores groups, non-sensitive connection settings, typed application
preferences, optional non-sensitive monitor metadata, and Key Vault
platform-protected private-key ciphertext. Schema migration 2
adds the singleton `app_settings` row and migration history. Schema migration 3
adds `theme_mode`. Schema migration 4 adds UI font size plus normal window
width, height, and maximized state, and upgrades the settings model to version
3. Schema migration 5 adds `key_vault_entries` and the connection fields
`private_key_source` and `key_vault_id`. Existing private-key connections are
left as `local_file`. Schema migration 20 extends `key_vault_entries` with
`storage_mode`, `protected_key_blob`, `protection_version`,
`source_file_name`, `requires_passphrase`, `legacy_file_path`, and `key_bits`;
existing rows become `legacy_file_path`. Application settings contain default remember choices,
host-key policy, dark/light/system theme mode, UI font size, connection
timeout, window state, onboarding completion, and the one-time TOFU risk
acknowledgement. The selected driver must be pure Go and work with
`CGO_ENABLED=0`.

Database files live below `os.UserConfigDir()` in a `ServerPilot` directory.
Schema changes use ordered, transactional, idempotent migrations recorded in
`schema_migrations`.

`SecretStore` is the only interface allowed to persist credentials:

```go
type SecretStore interface {
    Get(ctx context.Context, key string) ([]byte, error)
    Set(ctx context.Context, key string, value []byte) error
    Delete(ctx context.Context, key string) error
}
```

Windows stores remembered passwords and private-key passphrases in Credential
Manager through a build-tagged platform adapter. SQLite stores only a
connection-scoped credential reference and exposes a boolean saved state to the
frontend. Credential references use the stable
`ServerPilot/connection/<id>/<password|passphrase>` format. Changing host,
port, username, authentication type, or private-key path invalidates the old
reference; renaming or regrouping a server does not. The macOS adapter remains
isolated behind its Keychain platform boundary and must be completed and
verified on macOS before release.

Key Vault passphrases use a separate SecretStore namespace:
`ServerPilot/keyvault/<keyID>/passphrase`. SQLite stores only this opaque
reference plus `passphrase_saved`. For `encrypted_database` entries, updating a
key-vault passphrase validates against the decrypted protected blob; for
`legacy_file_path` entries it validates against the current file path. Failed
validation leaves the previous SecretStore value untouched. Deleting a
key-vault entry deletes its SecretStore passphrase after checking that no
server uses the entry. Deleting a server never deletes the key-vault entry it
references.

## 10. Cross-Platform Constraints

- Build paths use `filepath` and OS directory APIs.
- Core packages do not import Windows-only or macOS-only APIs.
- Platform secret adapters use build tags.
- SQLite must not require a C compiler.
- Remote collection targets Linux, while the desktop host remains Windows or
  macOS.
- Shell scripts use POSIX-compatible syntax and do not require root.
- macOS artifacts must be built on macOS because Wails/WebKit application
  packaging is not supported as a complete cross-build from Windows.

## 11. Stability and Accuracy

- Network values are bytes per second and are never multiplied by eight.
- CPU usage uses counter deltas, not instantaneous command output.
- Elapsed time comes from the actual interval, not the configured nominal
  interval.
- Histories contain real samples only; no fabricated demo values enter runtime
  stores.
- Theme mode is applied before Vue mounts when settings are available. System
  mode follows `prefers-color-scheme` changes and removes its listener during
  application teardown.
- All shared backend state is protected by mutexes or confined to one worker.

## 12. Terminal Geometry, Responsive Monitoring, And Process Compatibility

The right workspace assigns the terminal, SFTP divider, bottom SFTP panel, and
status bar to separate grid rows. The terminal host and xterm root are
absolutely positioned only inside the terminal row; every parent in that chain
has `min-height: 0` and `overflow: hidden`. SFTP and the status bar therefore
cannot overlay terminal cells.

Terminal fitting is a trailing, cancellable operation:

```text
layout state -> Vue nextTick -> two animation frames -> FitAddon.fit
             -> compare rows/columns -> coalesced backend PTY resize
```

Resize bursts replace the pending frontend fit. The terminal manager also
stores desired and applied sizes and applies only the latest changed size after
a short debounce. Closing the terminal cancels the resize worker before the
SSH shell is released. No layout change recreates an SSH session.

Terminal output follows the bottom only when the user was already at the
bottom. Scrolling into history disables forced following and exposes a
lightweight "return to bottom" control. Keyboard input returns to the active
prompt. Terminal font size remains independent from the application UI scale.

Frontend xterm instances are owned by `TerminalView` and are not tied to the
current top-level page. `TerminalWorkspace` remains mounted while the user
navigates to the full monitor dashboard, logs, or settings. Those pages hide
the SSH workspace with `visibility` and pointer-event control instead of
`v-if`, `v-show`, or `display: none`, so Vue navigation cannot dispose the
xterm instance or clear its scrollback/current input line.

An xterm instance may be disposed only when its `TerminalView` is genuinely
removed because the user closes that terminal, closes/disconnects the server
workspace, deletes the server, or exits the application. Page navigation,
server picker open/close, theme changes, UI font-size changes, SFTP panel
expansion, and window resize preserve the same frontend xterm instance and the
same backend terminal session.

While the SSH workspace is hidden, Wails terminal output remains subscribed and
continues to enter the existing xterm buffer. Hidden views do not run
`FitAddon.fit()` or publish PTY sizes. When the SSH workspace becomes visible
again, the active terminal waits for Vue `nextTick` and animation frames,
then fits and sends `ResizeTerminal` only if rows or columns changed. ServerPilot
does not record, persist, log, or replay unsubmitted terminal input to restore
the prompt; restoration comes from preserving xterm itself.

The full monitor dashboard observes its own routed content container with
`ResizeObserver`; it does not infer available space from the native window.
`resolveMonitorOverviewLayout(width, height, uiFontSize)` is a pure frontend
layout function that chooses metric columns, chart columns, chart height, and
one of three modes: `overview-fit`, `compact-fit`, or `scroll`. At default
1360x820, 1440x900, and 1920x1080 windows the routed content height is enough
for five metric columns and three same-row charts without vertical scrolling.
At narrow or short sizes such as 1024x700 the page intentionally uses `scroll`.

The monitor dashboard does not hide vertical overflow to fake a fit. CSS
variables from the resolved layout drive the metric grid, chart grid, and chart
height. The empty-data notice is a single compact row. The page forbids
page-level horizontal overflow. Each ECharts instance has one `ResizeObserver`,
reuses the same chart instance, schedules resize after layout, reacts to
theme/font changes, and disposes observers and animation frames on unmount.

UI font size is a typed four-value setting (`13`, `14`, `15`, or `16` px) and
is applied through CSS custom properties before Vue mounts. The default is
15 px. Window state stores normal width, normal height, and maximized state.
Startup clamps the saved size to the current logical screen with a safety
margin, centers the window, and then restores maximization.

Process collection is isolated from all other metrics and uses three levels:

1. validated GNU procps columns;
2. validated BusyBox/Toybox compatible columns;
3. bounded `/proc/<pid>` sampling using process ticks, RSS, and a capped
   command line.

The procfs path uses consecutive samples and aggregate `/proc/stat` deltas for
CPU percentages. Exited or unreadable PIDs are skipped individually. The
snapshot exposes loading, available, empty, unsupported, and failed states.
Only a changed process-collection failure is written to the structured log;
CPU, memory, network, disk, load, and uptime continue normally.

## SFTP Editor And Upload Refresh

The bottom SFTP panel remains bound to the active workspace server and uses the
formal SFTP manager transport. It does not reuse terminal or monitor sessions.

Remote text editing is implemented in the frontend with CodeMirror 6. The
editor is a single in-memory modal for bounded UTF-8 text returned by the
explicit `SftpReadTextFile` API. It provides line numbers, current-line
highlighting, undo/redo, tab indentation, Ctrl+S save, Ctrl+F search, match
count, previous/next navigation, case sensitivity, and theme-aware dark/light
colors. Language mode is selected by file name or extension; unsupported types
fall back to plain text. The editor content is not persisted in Pinia storage,
SQLite, logs, or application settings.

Closing a dirty editor uses the shared application dialog host with three
actions: save, discard, or cancel. Browser `alert`, `prompt`, and `confirm`
are not used. A failed save keeps the editor open and preserves the in-memory
buffer. Saves continue to use the existing backend size/mtime conflict check
and temporary-file-plus-rename path.

Upload refresh is driven by real `sftp:transfer` events. When an upload reaches
`completed`, the SFTP store schedules a short debounced refresh keyed by
`connectionId` and remote parent path. If the user is still viewing that same
server/path, the directory is re-listed once and the final uploaded remote path
is selected when present. If the user switched directory or server, the refresh
does not pull the UI back to the upload target. Refresh failures leave the
completed transfer record intact and surface a sanitized UI error.

The SFTP collapse/expand control lives inside the horizontal splitter. The
button consumes its own pointer events so dragging the splitter does not toggle
the panel and clicking the button does not start a resize drag. Expansion still
bumps the terminal layout revision so xterm fitting and backend PTY resize use
the existing coalesced path without recreating SSH sessions.

### SFTP Text Save Reliability

Remote text saves now use a staged backend flow with explicit failure metadata:
`stat_before_save`, `conflict_check`, `create_temp_file`, `write_temp_file`,
`close_temp_file`, `chmod_temp_file`, `rename_temp_to_target`,
`fallback_direct_write`, and `stat_after_save`. Save errors are serialized as
a typed JSON error string containing `code`, `stage`, `userMessage`,
`technicalMessage`, `remotePath`, `operation`, and `retryable`; the frontend
parses this object and shows a Chinese user message plus expandable technical
details while keeping the editor buffer open.

The save path creates a hidden temporary file in the same POSIX remote
directory using `.serverpilot-save-<basename>-<random>.tmp`, writes all UTF-8
bytes, closes the file handle, and best-effort applies the original permission
bits. Replacement prefers OpenSSH `posix-rename@openssh.com`; if unavailable,
it tries normal SFTP `Rename`. If both rename paths fail, the manager uses
`OpenFile(O_WRONLY|O_TRUNC)` as a direct-write fallback without deleting the
original target first. Temporary-file cleanup failure is logged as a warning
and does not mask the primary save result.

Conflict detection compares expected size and UTC Unix-second mtime. This
avoids false conflicts on SFTP servers that only preserve second-level
timestamps. If size or second-level mtime changed and `forceOverwrite` is not
set, the backend returns `SFTP_SAVE_CONFLICT`; the UI asks before retrying with
`forceOverwrite: true`.

CodeMirror uses a ServerPilot-specific dark/light theme with brighter text,
cursor, selection, search-match, line-number, and syntax token colors. This is
scoped to the remote text editor and does not change the SSH terminal theme.

Splitter chevrons use the shared `.splitter-handle-inline` class. The visual
control has no border, no button background, no capsule shape, and no
box-shadow; the larger hit area remains transparent and pointer events are
still isolated from splitter dragging.

### Splitter And Editor Polish

Splitter controls separate the invisible hit area from the visible chevron.
The hit area remains large enough to click, but the chevron itself is an
absolutely centered fixed-viewBox SVG `.splitter-chevron` inside the
transparent button. The SFTP horizontal splitter no longer depends on text
glyph baselines or HTML entity rendering. Pointer down on the chevron is
stopped before it can start a splitter drag; pointer down on the splitter line
still resizes the panel and bumps the terminal layout revision for xterm fit
and PTY resize.

The compact monitor sidebar now has an independent vertical display mode:
`split`, `monitorCollapsed`, or `mountsCollapsed`. The mode is stored in
`serverpilot.monitorSidebarSplitMode`; the existing
`serverpilot.monitorPaneHeight` value continues to store the last normal split
height. Collapsing the monitor pane lets mounts fill the sidebar; collapsing
the mounts pane lets the monitor pane fill the sidebar. Restoring returns to
the previous split height instead of writing zero-height ratios.

The remote text editor uses a higher-contrast ServerPilot CodeMirror theme.
The dark palette brightens body text, comments, strings, keywords, functions,
numbers, operators, cursor, active line, selections, gutters, and search
matches. The theme is scoped to the CodeMirror editor compartment and does not
alter SSH terminal colors or global application theme variables.

### Theme, Toast, And Chevron Final Polish

Splitter chevrons are now fixed-viewBox SVG icons instead of text glyphs or
HTML entities. The transparent `.splitter-handle-inline` button remains the
hit area, while the SVG `.splitter-chevron` is absolutely centered with
`left: 50%`, `top: 50%`, and `translate(-50%, -50%)`. Direction is handled by
CSS rotation classes, so the visual center no longer depends on font metrics,
line height, platform rendering, or terminal encoding.

Toast notifications are a global top layer. `ToastHost` teleports to `body`
and renders a fixed `.toast-layer` with `pointer-events: none`; the toast card
itself opts back into pointer events for close and detail buttons. The z-index
contract is `popover < context menu < modal < danger modal < busy < toast`,
using `--z-toast` as the highest overlay token so save notifications remain
visible above the remote editor modal, app dialogs, context menus, and server
picker popovers. Toast cards use content-adaptive width with a small minimum,
a viewport-bounded maximum, normal wrapping, and `overflow-wrap: anywhere`, so
short success messages stay compact while long server errors, paths, or English
tokens cannot stretch beyond the window.

Light theme support is token-driven. Shared UI surfaces use `--bg`,
`--sidebar`, `--panel`, `--panel-2`, `--panel-soft`, `--input`, `--border`,
`--text`, and `--muted`; SFTP-specific surfaces use `--sftp-surface` and
`--sftp-row-border`. SSH terminal surfaces intentionally keep the dedicated
dark `--terminal-bg` path. Modal, editor, drop-overlay, progress, toast, and
shadow colors are also expressed as theme tokens to avoid white-on-white or
black-on-black regressions.

The CodeMirror remote editor now has stronger dark and light high-contrast
palettes. Keywords, strings, numbers/constants, comments, variables,
functions, classes/types, tags, attributes, operators, punctuation, search
matches, selection, active line, gutter, cursor, and editor background each
have explicit colors. Theme switching reconfigures the CodeMirror theme
compartment only; it does not recreate the editor, reload the remote file, or
trigger a save.

## Backup Import And Export

Backup/import/export is implemented by `internal/backup.Service` and the
SQLite store methods `ExportBackupPayload`, `InspectBackupPayload`, and
`ImportBackupPayload`. The feature is exposed through typed Wails methods:
`SelectBackupExportPath`, `SelectBackupImportFile`, `ExportBackup`,
`InspectBackup`, and `ImportBackup`.

Backup files use a JSON envelope with `format = serverpilot-backup`,
`version = 1`, Argon2id KDF parameters, XChaCha20-Poly1305 cipher parameters,
a random 32-byte salt, a random XChaCha20 nonce, and base64 AEAD ciphertext.
The envelope contains only format, version, creation time, application name,
KDF/cipher parameters, nonce, salt, and encrypted payload. Server names, hosts,
usernames, private-key paths, Key Vault names, and host trust records are
inside the encrypted payload only.

The encrypted payload schema version is 1 and carries a backup mode:
`standard` or `full`. Standard backup is the default. It contains migratable
settings, groups, non-sensitive connection metadata, Key Vault metadata, and
connection host-key trust metadata. It does not contain passwords, private-key
passphrases, plaintext private-key contents, Key Vault `protected_key_blob`,
SecretStore keys, credential references, logs, terminal state, SFTP transfer
history, remote editor contents, open tabs, or active workspace state.

Full backup is an explicit high-risk mode protected by the same encrypted
payload envelope. It may include saved SSH passwords, local private-key
passphrases, and Key Vault passphrases by reading only the SecretStore values
referenced by SQLite metadata. SecretStore keys themselves are not exported.
Full backup still does not export Key Vault protected private-key blobs or
plaintext private-key material. Cross-computer encrypted Key Vault material
export/import requires a separate design and is not part of the current backup
format.

Import uses a SQLite transaction for metadata. Group IDs and Key Vault IDs are
regenerated and connections are remapped to local IDs. Servers are upserted by
`lower(host) + port + username`; matching records are updated instead of
duplicated with an import suffix. Existing local Key Vault entries with the
same fingerprint are reused and mapped. Missing Key Vault references are
imported without a stale key ID and warn that the user must select or import a
local key. Backup import must not clear the current machine's Key Vault.

Standard import clears credential state: imported password servers have no
saved password, local private-key connections have no saved passphrase, and
imported Key Vault entries have `passphrase_saved = false` with an empty
passphrase credential reference. Full import restores mapped SecretStore
values after the metadata transaction, then writes the new credential refs. If
the ref write fails, newly written SecretStore values are deleted.

`InspectBackup` decrypts the file only long enough to return counts, warnings,
conflict summaries, and the credential non-import notice. It never returns the
full decrypted payload to the frontend. `ImportBackup` decrypts the file again
for the actual import and never caches decrypted payloads in localStorage or a
long-lived backend structure.

## Terminal Command History And Favorites

Command history and grouped command favorites are an attachment layer on top of
the existing terminal input path. They do not change SSH dialing, PTY creation,
terminal session lifetime, terminal resize, monitor workers, SFTP workers,
`DisconnectServer`, the workspace state model, CredentialResolver,
SecretStore, or Key Vault.

The frontend observes terminal input before calling the existing
`WriteTerminal` API, but it does not block or replace that write. A per-session
line buffer records only submitted lines after Enter. It does not record
terminal output, ANSI buffer contents, unsubmitted input, SFTP file contents,
or remote editor content. If the recent terminal output looks like a password
or passphrase prompt, the next submitted line is skipped in the frontend.

The backend `internal/commands.Service` is the authoritative safety boundary.
It rejects empty commands, control sequences, multi-line paste content,
commands longer than 1000 characters, and common secret-bearing patterns such
as `password=`, `token=`, `Authorization:`, `sshpass -p`, `mysql -p...`, and
`curl -u user:password`. Skipped commands are not written to SQLite or logs.

Command history is stored in `command_history`, keyed by server ID and session
ID, with a normalized command hash. Consecutive duplicate commands update the
latest execution time instead of inserting another row. Each server keeps at
most the newest 2000 history rows.

Command favorites are stored in `command_favorites` with scopes `global`,
`group`, and `server`. They can be inserted into the active terminal without
Enter, or explicitly executed by writing the command plus Enter. If there is no
active online terminal, the UI shows a toast and does not create a terminal or
connect a server.

Command history and favorites are intentionally excluded from standard and
full backup payloads.

## Terminal Command Completion

Command completion is another attachment layer over the existing terminal
input path. It does not change SSH dialing, PTY lifecycle, terminal session
creation/destruction, resize behavior, monitor workers, SFTP workers,
`DisconnectServer`, the workspace state model, CredentialResolver,
SecretStore, or Key Vault.

Completion suggestions are served by the existing `internal/commands.Service`
through the typed `ListCommandSuggestions` Wails API. The service reuses
`command_history` and `command_favorites` and adds static builtin Linux command
templates in memory only; no database migration is required for this stage.

Suggestion sources are ranked in this order: current-server favorites,
current-group favorites, global favorites, current-server history, and builtin
templates. Candidates are filtered by the current prefix, deduplicated by
normalized command text, then sorted with recency, use count, and shorter
command tie-breakers. Builtins are not stored in SQLite and are not exported by
backup.

The frontend opens completion with Ctrl+Space. Tab remains untouched and is
sent to the remote shell while completion is closed. When completion is open,
ArrowUp/ArrowDown choose candidates, Enter inserts the candidate without
Enter, Ctrl+Enter writes the candidate plus Enter, Tab accepts the current
candidate, and Esc closes the overlay.

Insertion uses the same per-session line buffer created for command history.
If the current clean line is empty, the full command is written. If the current
clean line is a prefix of the candidate, only the suffix is written. Dirty or
unknown line state, sensitive-looking input, or alternate-screen terminal
programs block completion and show a toast instead of writing bytes.

## Local Terminal Runtime

Local Terminal is an independent runtime, not a variant of the SSH terminal
runtime and not part of a server workspace. It has its own manager,
session IDs, Wails APIs, events, frontend store, and xterm view. Local terminal
session IDs use the `local-<random>` form and must never be interpreted as
server IDs.

The backend module is `internal/localterminal`. It owns a session map, root
context, cancellable per-session context, PTY handle, shell process handle,
input queue, output reader, and close path. `Close` is idempotent and removes
the session from the manager before stopping the PTY so late writes and events
cannot revive the session.

Windows local terminals use `github.com/aymanbagabas/go-pty`, which wraps
ConPTY without implementing terminal emulation in ServerPilot. The same
adapter gives Unix PTY support for future macOS/Linux builds. Shell selection
on Windows prefers `pwsh.exe`, then `powershell.exe`, then `cmd.exe`.

The Wails boundary is typed:
`OpenLocalTerminal`, `WriteLocalTerminal`, `ResizeLocalTerminal`,
`CloseLocalTerminal`, `ListLocalTerminals`, and `GetLocalTerminalState`.
Events are separate from SSH terminal events:
`localterminal:output`, `localterminal:state`, and `localterminal:error`.
Output payloads are base64 so UTF-8 and ANSI bytes are not damaged by JSON.

Local terminal does not call or participate in `DisconnectServer(serverID)`.
Closing a server workspace does not close local terminal sessions, and closing
a local terminal tab does not disconnect SSH, monitor, or SFTP workers. App
shutdown closes all local terminal sessions through `CloseAll`.

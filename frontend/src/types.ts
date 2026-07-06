export type ConnectionStatus =
  | 'offline'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'disconnecting'
  | 'auth_failed'
  | 'timeout'
  | 'unreachable'
  | 'refused'
  | 'hostkey_mismatch'
  | 'key_error'
  | 'disconnected'
  | 'error'
export type AuthType = 'password' | 'private_key'
export type PrivateKeySource = 'local_file' | 'key_vault'
export type ConnectionMode = 'direct' | 'jump'
export type SecretUpdateMode = 'unchanged' | 'set' | 'delete'
export type HostKeyPolicy = 'auto_update' | 'strict'
export type ThemeMode = 'dark' | 'light' | 'system'
export type UIFontSize = 'tiny' | 'small' | 'standard' | 'large' | 'extra_large' | 'huge' | 'max'
export type TerminalCursorStyle = 'block' | 'underline' | 'bar'
export type TerminalThemeName = 'serverpilot-dark' | 'classic-dark' | 'light' | 'custom'

export interface TerminalProfile {
  id: string
  name: string
  fontFamily: string
  fontSize: number
  lineHeight: number
  letterSpacing: number
  cursorStyle: TerminalCursorStyle
  cursorBlink: boolean
  scrollback: number
  themeName: TerminalThemeName
  foreground: string
  background: string
  selectionBackground: string
  cursorColor: string
  createdAt: string
  updatedAt: string
}

export type SaveTerminalProfileRequest = Omit<TerminalProfile, 'createdAt' | 'updatedAt'>

export interface AssignServerTerminalProfileRequest {
  serverID: number
  terminalProfileId: string | null
}

export interface DeleteTerminalProfileRequest {
  id: string
  forceDetachServers: boolean
}

export interface DeleteTerminalProfileResponse {
  id: string
  detachedServers: number
}

export interface ResolveTerminalProfileRequest {
  serverID: number
}

export interface Group {
  id: number
  name: string
}

export interface MetricError {
  metric: string
  message: string
}

export interface Connection {
  id: number
  groupId: number | null
  sortOrder?: number
  name: string
  host: string
  port: number
  username: string
  authType: AuthType
  privateKeySource: PrivateKeySource
  privateKeyPath: string
  keyVaultId: number | null
  terminalProfileId?: string | null
  connectionMode?: ConnectionMode
  jumpServerId?: number | null
  hostKeyFingerprint: string
  credentialSaved: boolean
  passwordCredentialSaved?: boolean
  refreshInterval: 1 | 2 | 5
  networkInterfaceMode?: MonitorNetworkInterfaceMode
  selectedNetworkInterface?: string
  networkInterfaceUserSelected?: boolean
  createdAt: string
  updatedAt: string
}

export interface SaveConnectionRequest {
  id: number
  groupId: number | null
  name: string
  host: string
  port: number
  username: string
  authType: AuthType
  privateKeySource: PrivateKeySource
  privateKeyPath: string
  keyVaultId: number | null
  terminalProfileId?: string | null
  connectionMode?: ConnectionMode
  jumpServerId?: number | null
  refreshInterval: 1 | 2 | 5
}

export interface ReorderServersRequest {
  serverID: number
  sourceGroupID: number | null
  targetGroupID: number | null
  beforeServerID: number | null
  afterServerID: number | null
}

export interface SaveConnectionConfigRequest {
  connection: SaveConnectionRequest
  auth: AuthRequest
  connectAfterSave: boolean
}

export interface SaveConnectionConfigResult {
  connection: Connection
  connectAfterSave: boolean
}

export type DashboardSortMode = 'manual' | 'group' | 'remark' | 'cpu' | 'memory' | 'network'

export type AlertRuleType =
  | 'server_offline'
  | 'cpu_high'
  | 'memory_high'
  | 'root_disk_high'
  | 'latency_high'
  | 'test'

export type AlertSeverity = 'warning' | 'critical'
export type AlertEventState = 'firing' | 'resolved' | 'interrupted'
export type AlertSource = 'monitor' | 'connection' | 'test'

export interface OfflineAlertRuleSettings {
  enabled: boolean
  graceSeconds: number
}

export interface ThresholdAlertRuleSettings {
  enabled: boolean
  threshold: number
  durationSeconds: number
}

export interface AlertSettings {
  enabled: boolean
  notifyRecovery: boolean
  historyLimit: number
  offline: OfflineAlertRuleSettings
  cpu: ThresholdAlertRuleSettings
  memory: ThresholdAlertRuleSettings
  rootDisk: ThresholdAlertRuleSettings
  latency: ThresholdAlertRuleSettings
  nativeNotifications: NativeAlertNotificationSettings
}

export interface NativeAlertNotificationSettings {
  enabled: boolean
}

export interface NativeNotificationStatus {
  initialized: boolean
  available: boolean
  message: string
}

export type ShortcutBinding =
  | 'disabled'
  | 'ctrl+shift+a'
  | 'ctrl+shift+c'
  | 'ctrl+shift+v'
  | 'ctrl+shift+h'
  | 'ctrl+shift+p'
  | 'ctrl+alt+c'
  | 'ctrl+alt+v'
  | 'ctrl+alt+h'
  | 'ctrl+alt+p'

export type TerminalRightClickAction = 'paste' | 'menu'
export type TerminalContextMenuTrigger = 'shift_right_click' | 'ctrl_right_click' | 'disabled'

export interface ShortcutSettings {
  terminalCopyOnSelectEnabled: boolean
  terminalRightClickAction: TerminalRightClickAction
  terminalContextMenuTrigger: TerminalContextMenuTrigger
  terminalCopy: ShortcutBinding
  terminalPaste: ShortcutBinding
  terminalCompletion: ShortcutBinding
  openCommandHistory: ShortcutBinding
  openCommandFavorites: ShortcutBinding
}

export type ShortcutConflictStatus = 'available' | 'occupied' | 'reserved' | 'unknown'

export interface ShortcutConflictEntry {
  shortcut: string
  status: ShortcutConflictStatus
  message: string
}

export interface ShortcutConflictCheckRequest {
  shortcuts: string[]
}

export interface ShortcutConflictCheckResponse {
  entries: ShortcutConflictEntry[]
}

export interface AppVersionInfo {
  version: string
}

export interface AppSettings {
  defaultRememberPassword: boolean
  defaultRememberPassphrase: boolean
  terminalCopyOnSelectEnabled: boolean
  terminalRightClickPasteEnabled: boolean
  shortcutSettings: ShortcutSettings
  hostKeyPolicy: HostKeyPolicy
  themeMode: ThemeMode
  uiFontSize: UIFontSize
  localTerminalShellPreference: string
  localTerminalElevatedEnabled: boolean
  defaultTerminalProfileId: string
  commandHistoryMaxEntries: number
  sshKeepaliveEnabled: boolean
  sshKeepaliveIntervalSeconds: number
  sshKeepaliveTimeoutSeconds: number
  sshKeepaliveMaxFailures: number
  connectionTimeoutSeconds: 5 | 10 | 15 | 30
  dashboardSortMode: DashboardSortMode
  dashboardManualServerOrder: string[]
  alerts: AlertSettings
  backupImportOptions: BackupImportOptions
  windowWidth: number
  windowHeight: number
  windowMaximized: boolean
  settingsVersion: number
  onboardingCompleted: boolean
  trustOnFirstUseAcknowledged: boolean
}

export interface AlertEvent {
  eventID: string
  serverID: number
  serverName: string
  ruleType: AlertRuleType
  severity: AlertSeverity
  state: AlertEventState
  title: string
  message: string
  currentValue?: number
  threshold?: number
  unit?: '%' | 'ms'
  startedAt: string
  resolvedAt?: string
  read: boolean
  muted: boolean
  source: AlertSource
  sessionID?: string
  endedReason?: string
  readAt?: string
}

export interface BeginAlertSessionRequest {
  sessionID: string
  historyLimit: number
}

export interface ListAlertHistoryRequest {
  limit: number
}

export interface PersistAlertHistoryEventRequest {
  event: AlertEvent
  historyLimit: number
}

export interface AlertHistoryPersistResult {
  persisted: boolean
  skipped: boolean
  reasonCode: string
}

export interface MarkAlertHistoryReadRequest {
  eventID: string
}

export interface BackupExportRequest {
  path: string
  password: string
  confirmPassword: string
  mode: 'standard' | 'full'
}

export interface BackupExportResult {
  path: string
  createdAt: string
  mode: 'standard' | 'full'
  groups: number
  connections: number
  keyVaultEntries: number
  hostTrustRecords: number
  secretEntries: number
  encryptedFileSize: number
}

export interface BackupInspectRequest {
  path: string
  password: string
}

export interface BackupImportOptions {
  importSettings: boolean
  importGroups: boolean
  importServers: boolean
  importKeyVault: boolean
  importHostTrust: boolean
}

export interface BackupImportRequest {
  path: string
  password: string
  options: BackupImportOptions
}

export interface BackupWarning {
  code: string
  message: string
}

export interface BackupConflict {
  kind: string
  name: string
  message: string
}

export interface BackupPreview {
  format: string
  version: number
  createdAt: string
  exportedAt: string
  schemaVersion: number
  settingsCount: number
  groupCount: number
  connectionCount: number
  keyVaultCount: number
  hostTrustCount: number
  missingPrivateKeyPath: number
  conflictCount: number
  warnings: BackupWarning[]
  conflicts: BackupConflict[]
  credentialsNotice: string
}

export interface BackupImportResult {
  groupsAdded: number
  connectionsAdded: number
  keyVaultAdded: number
  hostTrustImported: number
  secretsRestored: number
  skipped: number
  renamed: number
  warnings: BackupWarning[]
  credentialsNotice: string
}

export type DockerContainerState = 'running' | 'exited' | 'paused' | 'restarting' | 'dead' | 'unknown'
export type DockerExecutionMode = 'current_user' | 'sudo'

export interface DockerAvailability {
  serverID: number
  available: boolean
  version: string
  error: string
  lastRefreshAt: string
  containers: DockerContainer[]
}

export interface DockerContainer {
  id: string
  shortID: string
  name: string
  image: string
  command: string
  createdAt: string
  status: string
  state: DockerContainerState
  ports: string
  labels: string
  size: string
  serverID: number
}

export interface DockerContainerStats {
  serverID: number
  containerID: string
  cpuPercent: number
  memoryUsage: number
  memoryLimit: number
  memoryPercent: number
  netInput: number
  netOutput: number
  blockInput: number
  blockOutput: number
  pids: number
  timestamp: string
}

export interface DockerInspectSummary {
  serverID: number
  id: string
  name: string
  image: string
  created: string
  state: DockerContainerState
  status: string
  ports: string
  mountCount: number
  networkNames: string[]
  restartPolicy: string
}

export interface DockerListContainersRequest {
  serverID: number
  executionMode?: DockerExecutionMode
}

export interface DockerServerRequest {
  serverID: number
  executionMode?: DockerExecutionMode
}

export interface DockerContainerRequest {
  serverID: number
  containerID: string
  executionMode?: DockerExecutionMode
}

export interface DockerBatchContainerRequest {
  serverID: number
  containerIDs: string[]
  executionMode?: DockerExecutionMode
}

export interface DockerBatchContainerResult {
  containerID: string
  name: string
  action: string
  status: 'success' | 'failed' | 'skipped' | string
  success: boolean
  error: string
  reason: string
}

export interface DockerBatchContainerResponse {
  serverID: number
  results: DockerBatchContainerResult[]
  successCount: number
  failedCount: number
  skippedCount: number
}

export interface DockerLogsRequest {
  serverID: number
  containerID: string
  tailLines: number
  executionMode?: DockerExecutionMode
}

export interface DockerLogStreamRequest {
  serverID: number
  containerID: string
  tailLines: number
  streamID: string
  executionMode?: DockerExecutionMode
}

export interface DockerStopLogStreamRequest {
  serverID: number
  streamID: string
}

export interface DockerStatsWatchRequest {
  serverID: number
  containerID: string
  watchID: string
  intervalMs: number
  executionMode?: DockerExecutionMode
}

export interface DockerStopStatsWatchRequest {
  serverID: number
  watchID: string
}

export interface DockerComposeCapability {
  serverID: number
  available: boolean
  command: string
  version: string
  error: string
  lastRefreshAt: string
}

export interface DockerComposeProject {
  serverID: number
  name: string
  status: string
  configFiles: string
  workingDir: string
}

export interface DockerComposeProjectsRequest {
  serverID: number
  executionMode?: DockerExecutionMode
}

export interface DockerComposeProjectRequest {
  serverID: number
  projectName: string
  executionMode?: DockerExecutionMode
}

export interface DockerComposeServiceDetailRequest {
  serverID: number
  projectName: string
  serviceName: string
  executionMode?: DockerExecutionMode
}

export interface DockerComposeService {
  serverID: number
  id: string
  name: string
  project: string
  service: string
  image: string
  command: string
  state: string
  status: string
  health: string
  ports: string
  exitCode: number
}

export interface DockerComposeServicesResponse {
  serverID: number
  projectName: string
  services: DockerComposeService[]
  timestamp: string
}

export interface DockerComposeLogsRequest {
  serverID: number
  projectName: string
  serviceName: string
  tailLines: number
  executionMode?: DockerExecutionMode
}

export interface DockerComposeLogsSnapshot {
  serverID: number
  projectName: string
  serviceName: string
  output: string
  truncated: boolean
  timestamp: string
}

export interface DockerStateEvent {
  serverID: number
  state: DockerAvailability
  timestamp: string
}

export interface DockerContainersEvent {
  serverID: number
  containers: DockerContainer[]
  timestamp: string
}

export interface DockerLogEvent {
  serverID: number
  containerID: string
  streamID: string
  line: string
  timestamp: string
}

export interface DockerStatsEvent {
  serverID: number
  containerID: string
  watchID: string
  stats: DockerContainerStats
  timestamp: string
}

export interface DockerErrorEvent {
  serverID: number
  containerID: string
  streamID: string
  code: string
  message: string
  timestamp: string
}

export type ServiceManagerInitSystem = 'systemd' | 'openwrt-procd' | 'unsupported'

export interface ServiceManagerServerRequest {
  serverID: number
}

export interface SystemServiceActionRequest {
  serverID: number
  unitName: string
  serviceID?: string
}

export interface ServiceManagerCapability {
  serverID: number
  available: boolean
  initSystem: ServiceManagerInitSystem
  displayName?: string
  systemdVersion?: string
  distributionName?: string
  distributionVersion?: string
  supportsJournal: boolean
  supportsLiveLogs: boolean
  supportsResourceMetrics: boolean
  supportsStart: boolean
  supportsStop: boolean
  supportsRestart: boolean
  supportsEnable: boolean
  supportsDisable: boolean
  canManage: boolean
  requiresPrivilege: boolean
  error?: string
}

export interface SystemServiceSummary {
  serverID: number
  initSystem: ServiceManagerInitSystem
  serviceID: string
  unitName: string
  displayName: string
  description: string
  startupState?: string
  loadState: string
  activeState: string
  subState: string
  unitFileState: string
  activeStateLabel: string
  unitFileStateLabel: string
  isActive: boolean
  isFailed: boolean
  isEnabled: boolean
  canStart: boolean
  canStop: boolean
  canRestart: boolean
  canEnable: boolean
  canDisable: boolean
  critical: boolean
  protected: boolean
}

export interface SystemServiceListResponse {
  serverID: number
  services: SystemServiceSummary[]
  timestamp: string
}

export interface SystemServiceDetail {
  serverID: number
  initSystem: ServiceManagerInitSystem
  serviceID: string
  unitName: string
  displayName?: string
  description: string
  startupState?: string
  loadState: string
  activeState: string
  subState: string
  unitFileState: string
  activeStateLabel: string
  unitFileStateLabel: string
  mainPID: number
  memoryCurrentBytes?: number
  cpuUsageNSec?: number
  tasksCurrent?: number
  restartCount?: number
  fragmentPath?: string
  scriptPath?: string
  distributionName?: string
  distributionVersion?: string
  lastUpdatedAt?: string
  result?: string
  startedAt?: string
  exitedAt?: string
  partial: boolean
  warnings?: string[]
  critical: boolean
  protected: boolean
}

export interface SystemServiceActionResponse {
  serverID: number
  serviceID?: string
  unitName: string
  action: string
  success: boolean
  message: string
  timestamp: string
}

export interface SystemServiceJournalRequest {
  serverID: number
  unitName: string
  lineLimit: number
  priority: ServiceJournalPriority
  currentBootOnly: boolean
}

export type ServiceJournalPriority = 'all' | 'error' | 'warning' | 'info' | 'debug'

export interface ServiceJournalLine {
  sequence: number
  timestamp?: string
  timestampText?: string
  priority: number
  priorityLabel: string
  identifier?: string
  pid?: string
  message: string
  truncated: boolean
}

export interface SystemServiceJournalResponse {
  serverID: number
  unitName: string
  lines: ServiceJournalLine[]
  fallback: boolean
  timestamp: string
}

export interface SystemServiceJournalFollowResponse {
  watchID: string
  serverID: number
  unitName: string
  startedAt: string
}

export interface StopSystemServiceJournalFollowRequest {
  serverID: number
  watchID: string
}

export interface ServiceJournalStateEvent {
  watchID: string
  serverID: number
  unitName: string
  state: string
  timestamp: string
}

export interface ServiceJournalLineEvent {
  watchID: string
  serverID: number
  unitName: string
  sequence: number
  line: ServiceJournalLine
  timestamp: string
}

export interface ServiceJournalErrorEvent {
  watchID: string
  serverID: number
  unitName: string
  code: string
  message: string
  timestamp: string
}

export interface ServiceJournalCompletedEvent {
  watchID: string
  serverID: number
  unitName: string
  reason?: string
  timestamp: string
}

export type TunnelType = 'local' | 'remote' | 'dynamic'
export type TunnelStatus = 'starting' | 'running' | 'failed' | 'stopping' | 'stopped'
export type RemoteListenCheckStatus = 'unchecked' | 'listening' | 'loopback_only' | 'not_listening' | 'unknown'
export type RemoteListenExposure = 'public' | 'loopback_only' | 'not_listening' | 'unknown'

export interface TunnelRuntime {
  tunnelID: string
  serverID: number
  profileID: number
  name: string
  type: TunnelType
  status: TunnelStatus
  bindHost: string
  bindPort: number
  targetHost: string
  targetPort: number
  remoteBindHost: string
  remoteBindPort: number
  requestedListen: string
  actualListen: string
  effectiveRemoteBindHost: string
  effectiveListenAddrs: string[]
  remoteListenExposure: RemoteListenExposure
  remoteListenCheckStatus: RemoteListenCheckStatus
  remoteListenWarning: string
  testCommand: string
  activeConnections: number
  bytesIn: number
  bytesOut: number
  startedAt: string
  updatedAt: string
  error: string
}

export interface TunnelProfile {
  id: number
  name: string
  serverID: number
  type: TunnelType
  bindHost: string
  bindPort: number
  targetHost: string
  targetPort: number
  remoteBindHost: string
  remoteBindPort: number
  autoStart: boolean
  createdAt: string
  updatedAt: string
}

export interface SaveTunnelProfileRequest {
  id: number
  name: string
  serverID: number
  type: TunnelType
  bindHost: string
  bindPort: number
  targetHost: string
  targetPort: number
  remoteBindHost: string
  remoteBindPort: number
  autoStart: boolean
}

export interface StartTunnelRequest {
  serverID: number
  profileID: number
  type: TunnelType
  name: string
  bindHost: string
  bindPort: number
  targetHost: string
  targetPort: number
  remoteBindHost: string
  remoteBindPort: number
  confirmPublicBind: boolean
  auth: AuthRequest
}

export interface StopTunnelRequest {
  serverID: number
  tunnelID: string
}

export interface RestartTunnelRequest {
  serverID: number
  tunnelID: string
  auth: AuthRequest
}

export interface ListTunnelsRequest {
  serverID: number
}

export interface CheckTunnelRemoteListenRequest {
  serverID: number
  tunnelID: string
}

export interface RemoteForwardAccessRequest {
  serverID: number
  tunnelID: string
  remoteBindHost: string
  remoteBindPort: number
}

export interface RemoteForwardAccessInspectResult {
  serverID: number
  sshdType: 'openssh' | 'dropbear' | 'unknown' | string
  configPath: string
  gatewayPortsEffective: 'yes' | 'no' | 'clientspecified' | 'unknown' | string
  allowTcpForwardingEffective: 'yes' | 'no' | 'unknown' | string
  canModify: boolean
  requiresSudo: boolean
  warnings: string[]
}

export interface RemoteForwardAccessEnableResult {
  success: boolean
  backupPath: string
  changedFiles: string[]
  reloadCommand: string
  message: string
  warnings: string[]
}

export interface RemoteForwardAccessRestartRequest {
  serverID: number
  tunnelID: string
  profileID: number
  auth: AuthRequest
}

export interface RemoteForwardAccessRestartResult {
  access: RemoteForwardAccessEnableResult
  runtime: TunnelRuntime
}

export interface TunnelStateEvent {
  serverID: number
  tunnelID: string
  state: TunnelRuntime
  timestamp: string
}

export interface TunnelErrorEvent {
  serverID: number
  tunnelID: string
  code: string
  message: string
  timestamp: string
}

export interface TunnelTrafficEvent {
  serverID: number
  tunnelID: string
  activeConnections: number
  bytesIn: number
  bytesOut: number
  timestamp: string
}

export interface CommandHistoryEntry {
  id: string
  serverId: number
  serverName?: string
  sessionId: string
  command: string
  preview?: string
  isMultiline?: boolean
  commandHash: string
  source: string
  sourceLabel?: string
  executedAt: string
  targetServerIds?: number[]
  targetCount?: number
  batchSubmissionId?: string
}

export interface RecordCommandHistoryRequest {
  serverId: number
  sessionId: string
  command: string
  source: string
}

export interface RecordCommandHistoryResult {
  recorded: boolean
  skipped: boolean
  reasonCode: string
  message: string
  entry?: CommandHistoryEntry
}

export interface RecordBatchCommandHistoryRequest {
  command: string
  successfulServerIds: number[]
  submissionId: string
}

export interface RecordBatchCommandHistoryResult {
  recorded: boolean
  skipped: boolean
  reasonCode: string
  message: string
  historyId: string
  targetCount: number
  entry?: CommandHistoryEntry
}

export interface UpdateCommandHistoryRequest {
  id: string
  command: string
}

export interface UpdateCommandHistoryResult {
  entry: CommandHistoryEntry
}

export interface ListCommandHistoryRequest {
  serverId: number
  scope?: 'all' | 'currentServer'
  query: string
  limit: number
}

export type CommandScope = 'global' | 'group' | 'server'

export interface CommandFavorite {
  id: string
  title: string
  command: string
  description: string
  scope: CommandScope
  serverId: number | null
  serverName?: string
  groupId: number | null
  groupName?: string
  tags: string[]
  sortOrder: number
  useCount: number
  createdAt: string
  updatedAt: string
  lastUsedAt: string
}

export interface ListCommandFavoritesRequest {
  serverId: number
  groupId: number | null
  scope?: 'all' | 'currentServer'
  query: string
}

export interface SaveCommandFavoriteRequest {
  id: string
  title: string
  command: string
  description: string
  scope: CommandScope
  serverId: number | null
  groupId: number | null
  tags: string[]
  sortOrder: number
  allowSensitive: boolean
}

export interface ListCommandSuggestionsRequest {
  serverId: number
  groupId: number | null
  prefix: string
  limit: number
  includeHistory: boolean
  includeFavorites: boolean
  includeBuiltins: boolean
}

export interface CommandSuggestion {
  id: string
  source: 'history' | 'favorite' | 'common' | 'builtin' | 'path'
  kind?: 'command' | 'argument' | 'path' | 'snippet'
  title: string
  command: string
  description: string
  scope: CommandScope | 'builtin'
  serverId: number | null
  groupId: number | null
  score: number
  useCount: number
  lastUsedAt: string
}

export type BatchCommandStatus =
  | 'queued'
  | 'connecting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'timeout'

export interface StartBatchCommandRequest {
  command: string
  serverIDs: number[]
  timeoutSeconds: number
  concurrency: number
}

export interface CancelBatchCommandServerRequest {
  taskID: string
  serverID: number
}

export interface CancelBatchCommandTaskRequest {
  taskID: string
}

export interface BatchCommandServerResult {
  taskID: string
  serverID: number
  serverName: string
  host: string
  status: BatchCommandStatus
  exitCode: number
  stdout: string
  stderr: string
  startedAt?: string
  completedAt?: string
  durationMs: number
  error: string
  outputTruncated: boolean
}

export interface BatchCommandTask {
  taskID: string
  command: string
  serverIDs: number[]
  status: BatchCommandStatus
  createdAt: string
  startedAt?: string
  completedAt?: string
  concurrency: number
  timeoutSeconds: number
  results: BatchCommandServerResult[]
}

export interface BatchCommandStateEvent {
  taskID: string
  serverID: number
  timestamp: string
  status: BatchCommandStatus
  result: BatchCommandServerResult
}

export interface BatchCommandOutputEvent {
  taskID: string
  serverID: number
  timestamp: string
  stream: 'stdout' | 'stderr' | string
  chunk: string
}

export interface BatchCommandCompletedEvent {
  taskID: string
  serverID: number
  timestamp: string
  status: BatchCommandStatus
  task: BatchCommandTask
}

export interface BatchCommandErrorEvent {
  taskID: string
  serverID: number
  timestamp: string
  code: string
  message: string
}

export interface HostKeyProbeResult {
  fingerprint: string
}

export interface ConnectionReachabilityResult {
  reachable: boolean
  connectionError?: ConnectionError
}

export interface AuthRequest {
  password: string
  passphrase: string
  trustUnknownHost: boolean
  rememberSecret: boolean
  secretUpdateMode?: SecretUpdateMode
}

export interface KeyVaultEntry {
  id: number
  name: string
  privateKeyPath: string
  storageMode?: 'encrypted_database' | 'legacy_file_path' | string
  sourceFileName?: string
  algorithm: string
  keyBits?: number
  publicKeyFingerprintSHA256: string
  encrypted: boolean
  requiresPassphrase?: boolean
  protectionVersion?: number
  passphraseSaved: boolean
  usageCount?: number
  notes: string
  createdAt: string
  updatedAt: string
  lastUsedAt: string
}

export interface SaveKeyVaultEntryRequest {
  id: number
  name: string
  privateKeyPath: string
  passphrase: string
  rememberPassphrase: boolean
  updatePassphrase: boolean
  deletePassphrase: boolean
  notes: string
}

export interface ValidatePrivateKeyFileRequest {
  privateKeyPath: string
  passphrase: string
}

export interface DeleteKeyVaultEntryRequest {
  id: number
  forceUnbind: boolean
}

export interface DeleteKeyVaultEntryResponse {
  deleted: boolean
  requiresConfirmation: boolean
  unboundServerCount: number
  unboundServerNames: string[]
  secretCleanupWarning: string
}

export interface PrivateKeyValidationResult {
  algorithm: string
  fingerprintSHA256: string
  keyBits?: number
  encrypted: boolean
  valid: boolean
  errorCode: string
  userMessage: string
  technicalMessage: string
}

export interface AuthenticationState {
  connectionId: number
  canAuthenticate: boolean
  credentialSaved: boolean
  credentialUsable: boolean
  privateKeyEncrypted: boolean
  hostTrusted: boolean
  reasonCode: string
  message: string
}

export interface ConnectionError {
  code: string
  userMessage: string
  technicalMessage: string
  retryable: boolean
  serverId: number
  operation: string
  timestamp: string
  stage?: string
  credentialServerId?: number
  credentialServerName?: string
  credentialFromStore?: boolean
  expectedFingerprint?: string
  observedFingerprint?: string
}

export interface ConnectionRuntimeState {
  connectionId: number
  status: ConnectionStatus
  monitorActive: boolean
  terminalActive: boolean
  terminalConnecting: boolean
  sftpActive: boolean
  connecting: boolean
  hasActiveSession: boolean
  lastError?: ConnectionError
  updatedAt: string
}

export type MonitorNetworkInterfaceMode = 'all' | 'interface' | 'physical' | 'docker'

export interface NetworkInterface {
  serverID: number
  name: string
  displayName: string
  isUp: boolean
  isLoopback: boolean
  ipv4: string[]
  ipv6: string[]
  mac?: string
  rxBytes: number
  txBytes: number
  rxPackets?: number
  txPackets?: number
  speedMbps?: number
  mtu?: number
  lastUpdatedAt: string
}

export interface ListNetworkInterfacesRequest {
  serverID: number
}

export interface ListNetworkInterfacesResponse {
  serverID: number
  interfaces: NetworkInterface[]
  updatedAt: string
  recommendedInterface: string
  recommendedInterfaceReason: string
}

export interface MonitorNetworkInterfacePreference {
  serverID: number
  mode: MonitorNetworkInterfaceMode
  selectedNetworkInterface: string
  userSelected: boolean
  updatedAt: string
}

export interface SetMonitorNetworkInterfaceRequest {
  serverID: number
  mode: MonitorNetworkInterfaceMode
  selectedNetworkInterface: string
  userSelected: boolean
}

export type NetworkDiagnosticType = 'ping' | 'traceroute' | 'dns' | 'tcp'
export type NetworkDiagnosticStatus = 'running' | 'completed' | 'failed' | 'canceled'

export interface StartNetworkDiagnosticRequest {
  serverID: number
  type: NetworkDiagnosticType
  target: string
  port?: number
  count?: number
  timeoutSeconds?: number
}

export interface CancelNetworkDiagnosticRequest {
  serverID: number
  taskID: string
}

export interface NetworkDiagnosticTask {
  taskID: string
  serverID: number
  type: NetworkDiagnosticType
  target: string
  port?: number
  status: NetworkDiagnosticStatus
  startedAt: string
  endedAt?: string
  error?: string
}

export interface NetworkDiagnosticStateEvent {
  serverID: number
  taskID: string
  timestamp: string
  task: NetworkDiagnosticTask
}

export interface NetworkDiagnosticOutputEvent {
  serverID: number
  taskID: string
  timestamp: string
  line: string
  stream: 'stdout' | 'stderr' | string
}

export interface OpenNetworkInspectionContextRequest {
  serverID: number
}

export interface OpenNetworkInspectionContextResponse {
  serverID: number
  contextID: string
  openedAt: string
}

export interface CloseNetworkInspectionContextRequest {
  serverID: number
  contextID: string
}

export interface NetworkEndpointSnapshotRequest {
  serverID: number
  contextID: string
  interfaceName?: string
  scope?: 'host' | 'full' | string
}

export interface NetworkEndpointSummary {
  rowID: string
  serverID: number
  protocol: 'tcp' | 'tcp6' | 'udp' | 'udp6' | string
  family: 'ipv4' | 'ipv6' | string
  listenAddress: string
  listenPort: number
  pid?: number | null
  pidLabel?: string
  processName: string
  sourceType?: 'host' | 'docker' | string
  sourceName?: string
  containerID?: string
  containerName?: string
  uniqueRemoteIPCount?: number | null
  connectionCount?: number | null
  uploadedBytes?: number | null
  uploadedBytesEstimate?: number | null
  uploadedBytesEstimated: boolean
  downloadedBytes?: number | null
  aggregatedProcessCount?: number | null
  connectionDataAvailable: boolean
  byteCountersAvailable: boolean
  byteCountersPartial: boolean
  permissionLimited: boolean
  aggregationApproximate: boolean
  hasListener: boolean
  hasActiveConnections: boolean
  rowKind: 'listener' | 'connection' | 'listener-and-connection' | string
  state: 'listening' | 'connected' | string
  lastUpdatedAt: string
}

export interface NetworkEndpointSnapshot {
  serverID: number
  contextID: string
  strategy: string
  listenersAvailable: boolean
  connectionsAvailable: boolean
  processInfoAvailable: boolean
  permissionLimited: boolean
  byteCountersAvailable: boolean
  byteCountersPartial: boolean
  listeners: NetworkEndpointSummary[]
  totalListeners: number
  totalConnections?: number | null
  uniqueRemoteIPs?: number | null
  socketConnectionCount?: number | null
  socketRemoteIPCount?: number | null
  hostSocketConnectionCount?: number | null
  hostRemoteIPCount?: number | null
  dockerSocketConnectionCount?: number | null
  dockerRemoteIPCount?: number | null
  totalSocketConnectionCount?: number | null
  totalRemoteIPCount?: number | null
  conntrackConnectionCount?: number | null
  conntrackRemoteIPCount?: number | null
  conntrackAvailable: boolean
  conntrackSource: string
  listenerCount?: number
  dockerAvailable?: boolean
  dockerNamespaceAvailable?: boolean
  dockerPermissionLimited?: boolean
  dockerContainerCount?: number
  dockerScannedContainerCount?: number
  dockerAggregated?: boolean
  dockerTruncated?: boolean
  interfaceScope?: string
  aggregated: boolean
  rawConnectionCountBeforeLimit?: number | null
  returnedRowCount: number
  rowLimit: number
  socketUploadBytesKnownCount: number
  socketUploadBytesEstimatedCount: number
  socketDownloadBytesKnownCount: number
  socketCounterMissingCount: number
  collectedAt: string
  warnings: string[]
}

export interface NetworkDiagnosticErrorEvent {
  serverID: number
  taskID: string
  timestamp: string
  message: string
  code: string
}

export interface MonitorSnapshot {
  connectionId: number
  status: ConnectionStatus
  timestamp: string
  latencyMillis: number
  latencyAvailable: boolean
  cpuPercent: number | null
  memoryTotal: number
  memoryAvailable: number
  memoryUsedPercent: number | null
  swapTotal: number
  swapFree: number
  diskTotal: number
  diskUsed: number
  diskUsedPercent: number | null
  mounts: DiskMount[]
  processes: ProcessInfo[]
  processStatus: 'loading' | 'available' | 'empty' | 'unsupported' | 'failed'
  processMessage: string
  loadOne: number | null
  loadFive: number | null
  loadFifteen: number | null
  uptimeSeconds: number | null
  defaultInterface: string
  networkInterfaceMode?: MonitorNetworkInterfaceMode
  selectedNetworkInterface?: string
  effectiveNetworkInterface?: string
  networkInterfaceFallback?: boolean
  networkInterfaceMessage?: string
  downloadBytesPerSecond: number | null
  uploadBytesPerSecond: number | null
  osName: string
  kernel: string
  architecture: string
  errors: MetricError[]
  errorCode: string
  message: string
  monitorActive: boolean
  connectionError?: ConnectionError
}

export interface DiskMount {
  filesystem: string
  mountPath: string
  total: number
  used: number
  available: number
  usedPercent: number
}

export interface ProcessInfo {
  pid: number
  cpuPercent: number
  memoryPercent: number
  command: string
}

export type ProcessSortBy = 'cpu' | 'memory' | 'pid' | 'user' | 'command'
export type ProcessSortDir = 'asc' | 'desc'
export type ProcessSignal = 'term' | 'kill'

export interface ProcessEntry {
  serverID: number
  pid: number
  ppid: number
  user: string
  state: string
  stateLabel: string
  cpuPercent: number
  memoryPercent: number
  rssBytes: number
  vszBytes: number
  command: string
  argsPreview: string
  startedOrElapsed: string
  isKernelThread: boolean
  canSignal: boolean
}

export interface ProcessDetail {
  serverID: number
  pid: number
  ppid: number
  user: string
  state: string
  stateLabel: string
  command: string
  cmdline: string
  cwd?: string
  exe?: string
  openFilesCount?: number
  threads?: number
  rssBytes: number
  vszBytes: number
  memoryPercent: number
  cpuPercent: number
  environmentRedacted: boolean
  children: ProcessEntry[]
  parent?: ProcessEntry
  lastUpdatedAt: string
  warnings: string[]
  isKernelThread: boolean
  canSignal: boolean
}

export interface ListProcessesRequest {
  serverID: number
  query?: string
  sortBy: ProcessSortBy
  sortDir: ProcessSortDir
  limit?: number
}

export interface ProcessListResponse {
  serverID: number
  processes: ProcessEntry[]
  warnings: string[]
  parserStrategy?: string
  timestamp: string
}

export interface GetProcessDetailRequest {
  serverID: number
  pid: number
}

export interface SignalProcessRequest {
  serverID: number
  pid: number
  signal: ProcessSignal
  expectedCommand?: string
}

export interface SignalProcessResponse {
  serverID: number
  pid: number
  success: boolean
  message: string
}

export interface StartProcessWatchRequest {
  serverID: number
  watchID?: string
  query?: string
  sortBy: ProcessSortBy
  sortDir: ProcessSortDir
  limit?: number
  intervalMs?: number
}

export interface StopProcessWatchRequest {
  serverID: number
  watchID: string
}

export interface ProcessStateEvent {
  serverID: number
  watchID: string
  state: string
  timestamp: string
}

export interface ProcessListEvent {
  serverID: number
  watchID: string
  processes: ProcessEntry[]
  warnings: string[]
  parserStrategy?: string
  timestamp: string
}

export interface ProcessDetailEvent {
  serverID: number
  watchID?: string
  detail: ProcessDetail
  timestamp: string
}

export interface ProcessErrorEvent {
  serverID: number
  watchID?: string
  code: string
  message: string
  timestamp: string
}

export interface TestConnectionResult {
  success: boolean
  latencyMillis: number
  hostKeyFingerprint: string
  errorCode: string
  message: string
  connectionError?: ConnectionError
}

export interface LogEntry {
  time: string
  level: string
  message: string
  summary: string
  serverName?: string
  connectionId?: number
  operation?: string
  error?: string
  technicalMessage?: string
  errorCode?: string
}

export type TerminalStatus = 'connecting' | 'online' | 'offline' | 'error'

export interface TerminalSessionInfo {
  sessionId: string
  connectionId: number
  title: string
  status: TerminalStatus
  code: string
  message: string
  connectionError?: ConnectionError
}

export type SFTPStatus = 'offline' | 'connecting' | 'online' | 'error'
export type SFTPMode = 'sftp' | 'scp'
export type SFTPBrowseCapability = 'full' | 'none'
export type SFTPTransferDirection = 'upload' | 'download'
export type SFTPTransferStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'resuming'
  | 'completed'
  | 'partial_failed'
  | 'failed'
  | 'canceled'
  | 'skipped'
export type SFTPConflictPolicy = 'ask' | 'overwrite' | 'skip' | 'rename'

export interface SFTPCapabilities {
  browse: SFTPBrowseCapability
  uploadFile: boolean
  downloadFile: boolean
  uploadDirectory: boolean
  downloadDirectory: boolean
  mkdir: boolean
  rename: boolean
  delete: boolean
  editText: boolean
}

export interface SFTPState {
  connectionId: number
  contextId?: string
  terminalSessionId?: string
  generation?: number
  status: SFTPStatus
  active: boolean
  mode?: SFTPMode
  capabilities?: SFTPCapabilities
  currentPath: string
  message: string
  updatedAt: string
}

export interface SFTPEntry {
  name: string
  path: string
  parentPath: string
  size: number
  isDir: boolean
  isSymlink: boolean
  permissions: string
  owner: string
  group: string
  modTime: string
}

export interface SFTPItemProperties {
  connectionId: number
  contextId?: string
  terminalSessionId?: string
  generation?: number
  requestId?: string
  path: string
  name: string
  type: 'file' | 'directory' | 'symlink' | 'other' | string
  size: number
  modTime: string
  permissions: string
  mode: number
  owner: string
  group: string
  isDir: boolean
  isSymlink: boolean
  symlinkTarget?: string
  entry: SFTPEntry
}

export interface SFTPListResult {
  connectionId: number
  contextId?: string
  generation?: number
  requestId?: string
  mode?: SFTPMode
  path: string
  parentPath: string
  entries: SFTPEntry[]
}

export interface SFTPInspectDeleteResponse {
  connectionId: number
  contextId?: string
  paths: string[]
  fileCount: number
  directoryCount: number
  symlinkCount: number
  totalBytes: number
  warnings: string[]
  requiresRecursive: boolean
}

export interface SFTPReadTextFileResult {
  connectionId: number
  contextId?: string
  generation?: number
  requestId?: string
  path?: string
  name?: string
  size?: number
  encoding?: string
  contentHash?: string
  truncated?: boolean
  entry: SFTPEntry
  content: string
  detectedLanguage?: string
  textKind?: string
}

export interface SFTPWriteTextFileResult {
  connectionId: number
  contextId?: string
  generation?: number
  requestId?: string
  path?: string
  name?: string
  size?: number
  encoding?: string
  contentHash?: string
  entry: SFTPEntry
}

export interface SFTPSaveError {
  code: string
  stage: string
  userMessage: string
  technicalMessage: string
  remotePath: string
  operation: string
  retryable: boolean
}

export interface SFTPTransferState {
  id: string
  connectionId: number
  contextId?: string
  terminalSessionId?: string
  generation?: number
  mode?: SFTPMode
  direction: SFTPTransferDirection
  recursive?: boolean
  sourceType?: 'file' | 'directory' | string
  localPath: string
  remotePath: string
  fileName: string
  currentFile?: string
  totalBytes: number
  transferredBytes: number
  currentFileBytesDone?: number
  currentFileBytesTotal?: number
  resumeOffset?: number
  filesTotal?: number
  filesDone?: number
  failedCount?: number
  skippedCount?: number
  percent: number
  speedBytesPerSecond: number
  status: SFTPTransferStatus
  errorMessage: string
  pauseRequested?: boolean
  cancelRequested?: boolean
  canPause?: boolean
  canResume?: boolean
  canCancel?: boolean
  cancelable?: boolean
  startedAt: string
  finishedAt: string
}

export interface SFTPTransferControlResponse {
  transferID: string
  status: SFTPTransferStatus
}

export interface SFTPErrorEvent {
  connectionId: number
  contextId?: string
  generation?: number
  requestId?: string
  operation: string
  code: string
  message: string
  technical: string
  updatedAt: string
}

export type ServerWorkspaceStatus =
  | 'offline'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'disconnected'

export interface ServerWorkspace {
  serverId: number
  serverName: string
  status: ServerWorkspaceStatus
  message: string
  error?: ConnectionError
  updatedAt: string
}

export interface TerminalOutputEvent {
  sessionId: string
  dataBase64: string
}

export interface TerminalStatusEvent {
  sessionId: string
  connectionId: number
  status: TerminalStatus
  code: string
  message: string
  active: boolean
  connectionError?: ConnectionError
}

export type LocalTerminalStatus = 'starting' | 'running' | 'exited' | 'failed' | 'closed'
export type LocalTerminalShellKind = 'cmd' | 'powershell' | 'local'

export interface LocalTerminalOpenRequest {
  shellKind: LocalTerminalShellKind | string
  elevated: boolean
  shell: string
  cwd: string
  rows: number
  cols: number
}

export interface LocalTerminalElevatedRelaunchRequest {
  shellKind: LocalTerminalShellKind | string
}

export interface LocalTerminalStartupRequest {
  shellKind: LocalTerminalShellKind | string
}

export interface LocalTerminalOpenResponse {
  sessionId: string
  shellKind: LocalTerminalShellKind | string
  shell: string
  shellName: string
  elevated: boolean
  title: string
  status: string
  cwd: string
  startedAt: string
}

export interface LocalTerminalShellOption {
  id: string
  label: string
  description: string
}

export interface LocalTerminalCapabilities {
  platform: 'windows' | 'darwin' | 'linux' | 'unknown'
  enabled: boolean
  supported: boolean
  conptyAvailable: boolean
  isProcessElevated: boolean
  supportsElevation: boolean
  shellOptions: LocalTerminalShellOption[]
  adminShellOptions: LocalTerminalShellOption[]
  defaultShellPreference: string
  currentShellPreference: string
  unsupportedMessage: string
}

export interface LocalTerminalWriteRequest {
  sessionId: string
  dataBase64: string
}

export interface LocalTerminalResizeRequest {
  sessionId: string
  rows: number
  cols: number
}

export interface LocalTerminalState {
  sessionId: string
  shellKind: LocalTerminalShellKind | string
  shell: string
  shellName: string
  elevated: boolean
  title: string
  cwd: string
  status: LocalTerminalStatus
  exitCode: number | null
  error: string
  startedAt: string
  endedAt: string
}

export interface LocalDrive {
  name: string
  path: string
}

export interface LocalExplorerHome {
  path: string
}

export interface LocalDirectoryRequest {
  path: string
}

export interface LocalPathRequest {
  path: string
}

export interface LocalFileEntry {
  name: string
  path: string
  size: number
  isDir: boolean
  modTime: string
  displayType: string
}

export interface LocalDirectoryListing {
  path: string
  parent: string
  entries: LocalFileEntry[]
}

export interface LocalNetworkInterface {
  name: string
  displayName: string
  description?: string
  isUp?: boolean
  hasGateway?: boolean
  isDefaultRoute?: boolean
  isPhysicalLike?: boolean
  isVirtual?: boolean
  isLoopback?: boolean
  isHiddenByDefault?: boolean
  speedBps?: number
  rxBytes?: number
  txBytes?: number
  uploadBytesPerSecond?: number
  downloadBytesPerSecond?: number
}

export interface LocalGpuSnapshot {
  name: string
  available: boolean
  usagePercent: number
  memoryUsedBytes: number
  memoryTotalBytes: number
  unavailableReason: string
}

export interface LocalDiskVolume {
  name: string
  mountPath: string
  total: number
  used: number
  available: number
  usedPercent: number
}

export interface LocalProcessInfo {
  pid: number
  name: string
  cpuPercent: number
  memoryBytes: number
  memoryPercent: number
}

export interface LocalResourceSnapshot {
  status: string
  hostname: string
  platform: string
  osName: string
  osVersion?: string
  osBuild?: string
  architecture?: string
  cpuModel?: string
  cpuCores?: number
  cpuLogicalProcessors?: number
  timestamp: string
  uptimeSeconds: number
  cpuPercent: number
  memoryTotal: number
  memoryAvailable: number
  memoryUsedPercent: number
  swapTotal: number
  swapFree: number
  pagefileTotal?: number
  pagefileFree?: number
  gpus?: LocalGpuSnapshot[]
  uploadBytesPerSecond: number
  downloadBytesPerSecond: number
  networkInterfaces: LocalNetworkInterface[]
  disks?: LocalDiskVolume[]
  processes?: LocalProcessInfo[]
}

export interface LocalTerminalOutputEvent {
  sessionId: string
  dataBase64: string
  timestamp: string
}

export interface LocalTerminalStateEvent {
  state: LocalTerminalState
  timestamp: string
}

export interface LocalTerminalErrorEvent {
  sessionId: string
  message: string
  timestamp: string
}

export interface ContextMenuItem {
  id: string
  label: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
}

export interface ToastMessage {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
  detail?: string
  code?: string
}

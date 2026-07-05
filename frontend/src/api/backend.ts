import type {
  AlertEvent, AlertHistoryPersistResult, AppSettings, AppVersionInfo, AuthenticationState, AuthRequest, BackupExportRequest, BackupExportResult, BackupImportRequest,
  BackupImportResult, BackupInspectRequest, BackupPreview, CommandFavorite, CommandHistoryEntry, CommandSuggestion, Connection, ConnectionRuntimeState, Group,
  AssignServerTerminalProfileRequest, DeleteKeyVaultEntryRequest, DeleteKeyVaultEntryResponse, DeleteTerminalProfileRequest, DeleteTerminalProfileResponse,
  BatchCommandTask, CancelBatchCommandServerRequest, CancelBatchCommandTaskRequest, StartBatchCommandRequest,
  DockerAvailability, DockerBatchContainerRequest, DockerBatchContainerResponse, DockerComposeCapability, DockerComposeLogsRequest, DockerComposeLogsSnapshot, DockerComposeProject, DockerComposeProjectRequest, DockerComposeProjectsRequest, DockerComposeService, DockerComposeServiceDetailRequest, DockerComposeServicesResponse, DockerContainer, DockerContainerRequest, DockerContainerStats, DockerInspectSummary, DockerListContainersRequest,
  DockerLogsRequest, DockerLogStreamRequest, DockerStatsWatchRequest, DockerStopLogStreamRequest, DockerStopStatsWatchRequest,
  ServiceManagerCapability, ServiceManagerServerRequest, StopSystemServiceJournalFollowRequest, SystemServiceActionRequest, SystemServiceActionResponse, SystemServiceDetail, SystemServiceJournalFollowResponse, SystemServiceJournalRequest, SystemServiceJournalResponse, SystemServiceListResponse,
  ConnectionReachabilityResult, HostKeyProbeResult, KeyVaultEntry, LocalDirectoryListing, LocalDirectoryRequest, LocalDrive, LocalExplorerHome, LocalPathRequest, LocalResourceSnapshot, LocalTerminalCapabilities, LocalTerminalElevatedRelaunchRequest,
  LocalTerminalOpenRequest, LocalTerminalOpenResponse, LocalTerminalResizeRequest, LocalTerminalStartupRequest,
  LocalTerminalState, LocalTerminalWriteRequest, LogEntry, MonitorNetworkInterfacePreference, MonitorSnapshot,
  NetworkDiagnosticTask, StartNetworkDiagnosticRequest, CancelNetworkDiagnosticRequest,
  CloseNetworkInspectionContextRequest, NetworkEndpointSnapshot, NetworkEndpointSnapshotRequest, OpenNetworkInspectionContextResponse,
  ListNetworkInterfacesRequest, ListNetworkInterfacesResponse, SetMonitorNetworkInterfaceRequest,
  PrivateKeyValidationResult,
  GetProcessDetailRequest, ListProcessesRequest, ProcessDetail, ProcessListResponse,
  SignalProcessRequest, SignalProcessResponse, StartProcessWatchRequest, StopProcessWatchRequest,
  SaveConnectionConfigRequest, SaveConnectionConfigResult, SaveConnectionRequest, SaveKeyVaultEntryRequest,
  ReorderServersRequest,
  SaveTerminalProfileRequest, TerminalProfile,
  TerminalSessionInfo, SFTPConflictPolicy, SFTPEntry, SFTPInspectDeleteResponse, SFTPItemProperties, SFTPListResult, SFTPReadTextFileResult, SFTPState,
  SFTPTransferControlResponse, SFTPTransferState, SFTPWriteTextFileResult, TestConnectionResult,
  ValidatePrivateKeyFileRequest,
  ListCommandFavoritesRequest, ListCommandHistoryRequest, ListCommandSuggestionsRequest, RecordBatchCommandHistoryRequest,
  RecordBatchCommandHistoryResult, RecordCommandHistoryRequest, RecordCommandHistoryResult, SaveCommandFavoriteRequest,
  UpdateCommandHistoryRequest, UpdateCommandHistoryResult,
  ShortcutConflictCheckRequest, ShortcutConflictCheckResponse,
  CheckTunnelRemoteListenRequest, ListTunnelsRequest, RemoteForwardAccessEnableResult, RemoteForwardAccessInspectResult,
  RemoteForwardAccessRequest, RemoteForwardAccessRestartRequest, RemoteForwardAccessRestartResult,
  RestartTunnelRequest, SaveTunnelProfileRequest, StartTunnelRequest, StopTunnelRequest,
  TunnelProfile, TunnelRuntime,
} from '../types'

type SFTPTextSaveMode = 'save_existing' | 'create_new' | 'save_as'
type SFTPTextConflictPolicy = 'fail_if_changed' | 'fail_if_exists' | 'overwrite'

type BackendApp = {
  ListGroups(): Promise<Group[]>
  SaveGroup(group: Group): Promise<Group>
  DeleteGroup(id: number): Promise<void>
  ListConnections(): Promise<Connection[]>
  SaveConnection(request: SaveConnectionRequest): Promise<Connection>
  ReorderServers(request: ReorderServersRequest): Promise<Connection[]>
  SaveConnectionConfig(request: SaveConnectionConfigRequest): Promise<SaveConnectionConfigResult>
  DeleteSavedCredential(id: number): Promise<void>
  ListKeyVaultEntries(): Promise<KeyVaultEntry[]>
  CreateKeyVaultEntry(request: SaveKeyVaultEntryRequest): Promise<KeyVaultEntry>
  UpdateKeyVaultEntry(request: SaveKeyVaultEntryRequest): Promise<KeyVaultEntry>
  MigrateLegacyPrivateKey(request: SaveKeyVaultEntryRequest): Promise<KeyVaultEntry>
  DeleteKeyVaultEntry(request: DeleteKeyVaultEntryRequest): Promise<DeleteKeyVaultEntryResponse>
  ValidatePrivateKeyFile(request: ValidatePrivateKeyFileRequest): Promise<PrivateKeyValidationResult>
  DeleteKeyVaultPassphrase(id: number): Promise<void>
  UpdateKeyVaultPassphrase(id: number, passphrase: string): Promise<KeyVaultEntry>
  DeleteConnection(id: number): Promise<void>
  TestConnection(request: { connectionId: number; auth: AuthRequest }): Promise<TestConnectionResult>
  Connect(request: { connectionId: number; auth: AuthRequest }): Promise<void>
  Disconnect(id: number): Promise<void>
  DisconnectServer(id: number): Promise<void>
  GetMonitorSnapshot(id: number): Promise<MonitorSnapshot>
  ListNetworkInterfaces(request: ListNetworkInterfacesRequest): Promise<ListNetworkInterfacesResponse>
  GetMonitorNetworkInterface(serverID: number): Promise<MonitorNetworkInterfacePreference>
  SetMonitorNetworkInterface(request: SetMonitorNetworkInterfaceRequest): Promise<MonitorNetworkInterfacePreference>
  StartNetworkDiagnostic(request: StartNetworkDiagnosticRequest): Promise<NetworkDiagnosticTask>
  CancelNetworkDiagnostic(request: CancelNetworkDiagnosticRequest): Promise<void>
  ListNetworkDiagnosticTasks(serverID: number): Promise<NetworkDiagnosticTask[]>
  OpenNetworkInspectionContext(request: { serverID: number }): Promise<OpenNetworkInspectionContextResponse>
  GetNetworkEndpointSnapshot(request: NetworkEndpointSnapshotRequest): Promise<NetworkEndpointSnapshot>
  CloseNetworkInspectionContext(request: CloseNetworkInspectionContextRequest): Promise<void>
  ListProcesses(request: ListProcessesRequest): Promise<ProcessListResponse>
  GetProcessDetail(request: GetProcessDetailRequest): Promise<ProcessDetail>
  SignalProcess(request: SignalProcessRequest): Promise<SignalProcessResponse>
  StartProcessWatch(request: StartProcessWatchRequest): Promise<string>
  StopProcessWatch(request: StopProcessWatchRequest): Promise<void>
  GetConnectionState(id: number): Promise<ConnectionRuntimeState>
  GetSettings(): Promise<AppSettings>
  GetAppVersion(): Promise<AppVersionInfo>
  GetDefaultSettings(): Promise<AppSettings>
  SaveSettings(settings: AppSettings): Promise<AppSettings>
  CheckShortcutConflicts(request: ShortcutConflictCheckRequest): Promise<ShortcutConflictCheckResponse>
  PersistWindowState(): Promise<void>
  BeginAlertSession(request: { sessionID: string; historyLimit: number }): Promise<void>
  ListAlertHistory(request: { limit: number }): Promise<AlertEvent[]>
  PersistAlertHistoryEvent(request: { event: AlertEvent; historyLimit: number }): Promise<AlertHistoryPersistResult>
  MarkAlertHistoryRead(request: { eventID: string }): Promise<void>
  MarkAllAlertHistoryRead(request: Record<string, never>): Promise<void>
  ClearResolvedAlertHistory(request: Record<string, never>): Promise<void>
  ListTerminalProfiles(): Promise<TerminalProfile[]>
  CreateTerminalProfile(request: SaveTerminalProfileRequest): Promise<TerminalProfile>
  UpdateTerminalProfile(request: SaveTerminalProfileRequest): Promise<TerminalProfile>
  DuplicateTerminalProfile(id: string): Promise<TerminalProfile>
  DeleteTerminalProfile(request: DeleteTerminalProfileRequest): Promise<DeleteTerminalProfileResponse>
  SetDefaultTerminalProfile(id: string): Promise<AppSettings>
  AssignServerTerminalProfile(request: AssignServerTerminalProfileRequest): Promise<Connection>
  GetResolvedTerminalProfile(request: { serverID: number }): Promise<TerminalProfile>
  GetLocalTerminalCapabilities(): Promise<LocalTerminalCapabilities>
  GetLocalResourceSnapshot(): Promise<LocalResourceSnapshot>
  GetLocalExplorerHome(): Promise<LocalExplorerHome>
  GetLocalDrives(): Promise<LocalDrive[]>
  ListLocalDirectory(request: LocalDirectoryRequest): Promise<LocalDirectoryListing>
  OpenLocalPath(request: LocalPathRequest): Promise<void>
  RevealLocalPath(request: LocalPathRequest): Promise<void>
  ShowLocalPathProperties(request: LocalPathRequest): Promise<void>
  GetStartupLocalTerminalRequest(): Promise<LocalTerminalStartupRequest>
  RelaunchElevatedLocalTerminal(request: LocalTerminalElevatedRelaunchRequest): Promise<void>
  ProbeConnectionReachability(id: number): Promise<ConnectionReachabilityResult>
  ProbeHostKey(id: number): Promise<HostKeyProbeResult>
  TrustHostKey(request: { connectionId: number; expectedFingerprint: string }): Promise<void>
  ListLogs(limit: number): Promise<LogEntry[]>
  LogFrontendError(source: string): Promise<void>
  SelectPrivateKeyFile(): Promise<string>
  SelectBackupExportPath(): Promise<string>
  SelectBackupImportFile(): Promise<string>
  ExportBackup(request: BackupExportRequest): Promise<BackupExportResult>
  InspectBackup(request: BackupInspectRequest): Promise<BackupPreview>
  ImportBackup(request: BackupImportRequest): Promise<BackupImportResult>
  ListTunnelProfiles(): Promise<TunnelProfile[]>
  CreateTunnelProfile(request: SaveTunnelProfileRequest): Promise<TunnelProfile>
  UpdateTunnelProfile(request: SaveTunnelProfileRequest): Promise<TunnelProfile>
  DeleteTunnelProfile(id: number): Promise<void>
  ListTunnels(request: ListTunnelsRequest): Promise<TunnelRuntime[]>
  StartTunnel(request: StartTunnelRequest): Promise<TunnelRuntime>
  StopTunnel(request: StopTunnelRequest): Promise<void>
  RestartTunnel(request: RestartTunnelRequest): Promise<TunnelRuntime>
  GetTunnelState(tunnelID: string): Promise<TunnelRuntime>
  CheckTunnelRemoteListen(request: CheckTunnelRemoteListenRequest): Promise<TunnelRuntime>
  InspectRemoteForwardAccess(request: RemoteForwardAccessRequest): Promise<RemoteForwardAccessInspectResult>
  EnableRemoteForwardAccess(request: RemoteForwardAccessRequest): Promise<RemoteForwardAccessEnableResult>
  EnableRemoteForwardAccessAndRestart(request: RemoteForwardAccessRestartRequest): Promise<RemoteForwardAccessRestartResult>
  DockerCheck(serverID: number): Promise<DockerAvailability>
  DockerListContainers(request: DockerListContainersRequest): Promise<DockerContainer[]>
  DockerStartContainer(request: DockerContainerRequest): Promise<void>
  DockerStopContainer(request: DockerContainerRequest): Promise<void>
  DockerRestartContainer(request: DockerContainerRequest): Promise<void>
  DockerRemoveContainer(request: DockerContainerRequest): Promise<void>
  DockerBatchStartContainers(request: DockerBatchContainerRequest): Promise<DockerBatchContainerResponse>
  DockerBatchStopContainers(request: DockerBatchContainerRequest): Promise<DockerBatchContainerResponse>
  DockerBatchRestartContainers(request: DockerBatchContainerRequest): Promise<DockerBatchContainerResponse>
  DockerBatchRemoveContainers(request: DockerBatchContainerRequest): Promise<DockerBatchContainerResponse>
  DockerGetContainerLogs(request: DockerLogsRequest): Promise<string>
  DockerStartLogStream(request: DockerLogStreamRequest): Promise<string>
  DockerStopLogStream(request: DockerStopLogStreamRequest): Promise<void>
  DockerGetContainerInspectSummary(request: DockerContainerRequest): Promise<DockerInspectSummary>
  DockerGetContainerStats(request: DockerContainerRequest): Promise<DockerContainerStats>
  DockerStartStatsWatch(request: DockerStatsWatchRequest): Promise<string>
  DockerStopStatsWatch(request: DockerStopStatsWatchRequest): Promise<void>
  DockerComposeCheck(serverID: number): Promise<DockerComposeCapability>
  DockerComposeListProjects(request: DockerComposeProjectsRequest): Promise<DockerComposeProject[]>
  DockerComposeGetServices(request: DockerComposeProjectRequest): Promise<DockerComposeServicesResponse>
  DockerComposeGetServiceDetail(request: DockerComposeServiceDetailRequest): Promise<DockerComposeService>
  DockerComposeGetLogs(request: DockerComposeLogsRequest): Promise<DockerComposeLogsSnapshot>
  CheckServiceManager(request: ServiceManagerServerRequest): Promise<ServiceManagerCapability>
  ListSystemServices(request: ServiceManagerServerRequest): Promise<SystemServiceListResponse>
  GetSystemServiceDetail(request: SystemServiceActionRequest): Promise<SystemServiceDetail>
  StartSystemService(request: SystemServiceActionRequest): Promise<SystemServiceActionResponse>
  StopSystemService(request: SystemServiceActionRequest): Promise<SystemServiceActionResponse>
  RestartSystemService(request: SystemServiceActionRequest): Promise<SystemServiceActionResponse>
  EnableSystemService(request: SystemServiceActionRequest): Promise<SystemServiceActionResponse>
  DisableSystemService(request: SystemServiceActionRequest): Promise<SystemServiceActionResponse>
  CancelSystemServiceRequests(request: ServiceManagerServerRequest): Promise<void>
  GetSystemServiceJournal(request: SystemServiceJournalRequest): Promise<SystemServiceJournalResponse>
  StartSystemServiceJournalFollow(request: SystemServiceJournalRequest): Promise<SystemServiceJournalFollowResponse>
  StopSystemServiceJournalFollow(request: StopSystemServiceJournalFollowRequest): Promise<void>
  ListCommandHistory(request: ListCommandHistoryRequest): Promise<CommandHistoryEntry[]>
  RecordCommandHistory(request: RecordCommandHistoryRequest): Promise<RecordCommandHistoryResult>
  RecordBatchCommandHistory(request: RecordBatchCommandHistoryRequest): Promise<RecordBatchCommandHistoryResult>
  UpdateCommandHistory(request: UpdateCommandHistoryRequest): Promise<UpdateCommandHistoryResult>
  DeleteCommandHistory(id: string): Promise<void>
  ClearCommandHistory(serverId: number): Promise<void>
  ListCommandFavorites(request: ListCommandFavoritesRequest): Promise<CommandFavorite[]>
  CreateCommandFavorite(request: SaveCommandFavoriteRequest): Promise<CommandFavorite>
  UpdateCommandFavorite(request: SaveCommandFavoriteRequest): Promise<CommandFavorite>
  DeleteCommandFavorite(id: string): Promise<void>
  IncrementCommandFavoriteUse(id: string): Promise<CommandFavorite>
  ListCommandSuggestions(request: ListCommandSuggestionsRequest): Promise<CommandSuggestion[]>
  StartBatchCommand(request: StartBatchCommandRequest): Promise<BatchCommandTask>
  CancelBatchCommandServer(request: CancelBatchCommandServerRequest): Promise<void>
  CancelBatchCommandTask(request: CancelBatchCommandTaskRequest): Promise<void>
  GetBatchCommandTask(taskID: string): Promise<BatchCommandTask>
  ListBatchCommandTasks(): Promise<BatchCommandTask[]>
  ClearBatchCommandTask(taskID: string): Promise<void>
  GetAuthenticationState(id: number): Promise<AuthenticationState>
  ResetHostKeyTrust(id: number): Promise<void>
  OpenTerminal(request: { connectionId: number; auth: AuthRequest; columns: number; rows: number }): Promise<TerminalSessionInfo>
  WriteTerminal(request: { sessionId: string; dataBase64: string }): Promise<void>
  ResizeTerminal(request: { sessionId: string; columns: number; rows: number }): Promise<void>
  CloseTerminal(sessionId: string): Promise<void>
  ReconnectTerminal(request: { sessionId: string; connectionId: number; auth: AuthRequest; columns: number; rows: number }): Promise<TerminalSessionInfo>
  OpenLocalTerminal(request: LocalTerminalOpenRequest): Promise<LocalTerminalOpenResponse>
  WriteLocalTerminal(request: LocalTerminalWriteRequest): Promise<void>
  ResizeLocalTerminal(request: LocalTerminalResizeRequest): Promise<void>
  CloseLocalTerminal(sessionId: string): Promise<void>
  ListLocalTerminals(): Promise<LocalTerminalState[]>
  GetLocalTerminalState(sessionId: string): Promise<LocalTerminalState>
  OpenSftp(request: { connectionId: number; contextId?: string; terminalSessionId?: string; auth: AuthRequest }): Promise<SFTPState>
  ReconnectSftp(request: { connectionId: number; contextId?: string; terminalSessionId?: string; auth: AuthRequest }): Promise<SFTPState>
  CloseSftp(connectionId: number): Promise<void>
  CloseSftpContext(request: { connectionId: number; contextId: string; terminalSessionId?: string }): Promise<void>
  GetSftpState(connectionId: number): Promise<SFTPState>
  GetSftpContextState(request: { connectionId: number; contextId: string; terminalSessionId?: string }): Promise<SFTPState>
  ReadSftpDir(request: { connectionId: number; contextId?: string; terminalSessionId?: string; path: string; requestId?: string }): Promise<SFTPListResult>
  SftpGoHome(request: { connectionId: number; contextId?: string; terminalSessionId?: string; requestId?: string }): Promise<SFTPListResult>
  SftpGoParent(request: { connectionId: number; contextId?: string; terminalSessionId?: string; requestId?: string }): Promise<SFTPListResult>
  SftpMkdir(request: { connectionId: number; contextId?: string; terminalSessionId?: string; path: string }): Promise<void>
  SftpRename(request: { connectionId: number; contextId?: string; terminalSessionId?: string; oldPath: string; newPath: string }): Promise<void>
  SftpDelete(request: { connectionId: number; contextId?: string; terminalSessionId?: string; path?: string; paths?: string[]; isDir?: boolean; recursive?: boolean }): Promise<void>
  SftpInspectDelete(request: { connectionId: number; contextId?: string; terminalSessionId?: string; paths: string[]; recursive: boolean }): Promise<SFTPInspectDeleteResponse>
  SftpStat(request: { connectionId: number; contextId?: string; terminalSessionId?: string; path: string }): Promise<SFTPEntry>
  SftpGetRemoteItemProperties(request: { connectionId: number; contextId?: string; terminalSessionId?: string; generation?: number; requestId?: string; path: string }): Promise<SFTPItemProperties>
  SftpUpdateRemoteItemPermissions(request: { connectionId: number; contextId?: string; terminalSessionId?: string; generation?: number; requestId?: string; path: string; mode: number; preserveSpecialBits: boolean }): Promise<SFTPItemProperties>
  SftpReadTextFile(request: { connectionId: number; contextId?: string; terminalSessionId?: string; path: string; maxBytes: number; requestId?: string }): Promise<SFTPReadTextFileResult>
  SftpWriteTextFile(request: {
    connectionId: number
    contextId?: string
    terminalSessionId?: string
    path: string
    content: string
    expectedSize: number
    expectedMTime: string
    expectedHash?: string
    encoding?: string
    generation?: number
    requestId?: string
    mode?: SFTPTextSaveMode
    conflictPolicy?: SFTPTextConflictPolicy
    forceOverwrite: boolean
  }): Promise<SFTPWriteTextFileResult>
  SftpUpload(request: { connectionId: number; contextId?: string; terminalSessionId?: string; localPath: string; remotePath: string; conflictPolicy: SFTPConflictPolicy }): Promise<SFTPTransferState>
  SftpDownload(request: { connectionId: number; contextId?: string; terminalSessionId?: string; localPath: string; remotePath: string; conflictPolicy: SFTPConflictPolicy }): Promise<SFTPTransferState>
  SftpUploadDirectory(request: { connectionId: number; contextId?: string; terminalSessionId?: string; localPath: string; remoteDirectory: string; conflictPolicy: SFTPConflictPolicy }): Promise<SFTPTransferState>
  SftpDownloadDirectory(request: { connectionId: number; contextId?: string; terminalSessionId?: string; remotePath: string; localDirectory: string; conflictPolicy: SFTPConflictPolicy }): Promise<SFTPTransferState>
  SftpCancelTransfer(request: { transferId: string; contextId?: string }): Promise<void>
  SftpPauseTransfer(request: { serverID: number; contextID: string; transferID: string }): Promise<SFTPTransferControlResponse>
  SftpResumeTransfer(request: { serverID: number; contextID: string; transferID: string }): Promise<SFTPTransferControlResponse>
  SelectLocalUploadFiles(): Promise<string[]>
  SelectLocalUploadDirectory(): Promise<string>
  SelectLocalDownloadDirectory(): Promise<string>
}

declare global {
  interface Window {
    go?: { main?: { App?: BackendApp } }
  }
}

function backend(): BackendApp {
  const app = window.go?.main?.App
  if (!app) throw new Error('Wails backend is unavailable. Run through wails dev.')
  return app
}

function logFrontendError(source: string): Promise<void> {
  const app = window.go?.main?.App
  return app ? app.LogFrontendError(source) : Promise.resolve()
}

export const api = {
  listGroups: () => backend().ListGroups(),
  saveGroup: (group: Group) => backend().SaveGroup(group),
  deleteGroup: (id: number) => backend().DeleteGroup(id),
  listConnections: () => backend().ListConnections(),
  saveConnection: (request: SaveConnectionRequest) => backend().SaveConnection(request),
  reorderServers: (request: ReorderServersRequest) => backend().ReorderServers(request),
  saveConnectionConfig: (request: SaveConnectionConfigRequest) => backend().SaveConnectionConfig(request),
  deleteSavedCredential: (id: number) => backend().DeleteSavedCredential(id),
  listKeyVaultEntries: () => backend().ListKeyVaultEntries(),
  createKeyVaultEntry: (request: SaveKeyVaultEntryRequest) => backend().CreateKeyVaultEntry(request),
  updateKeyVaultEntry: (request: SaveKeyVaultEntryRequest) => backend().UpdateKeyVaultEntry(request),
  migrateLegacyPrivateKey: (request: SaveKeyVaultEntryRequest) => backend().MigrateLegacyPrivateKey(request),
  deleteKeyVaultEntry: (request: DeleteKeyVaultEntryRequest) => backend().DeleteKeyVaultEntry(request),
  validatePrivateKeyFile: (request: ValidatePrivateKeyFileRequest) => backend().ValidatePrivateKeyFile(request),
  deleteKeyVaultPassphrase: (id: number) => backend().DeleteKeyVaultPassphrase(id),
  updateKeyVaultPassphrase: (id: number, passphrase: string) =>
    backend().UpdateKeyVaultPassphrase(id, passphrase),
  deleteConnection: (id: number) => backend().DeleteConnection(id),
  testConnection: (connectionId: number, auth: AuthRequest) => backend().TestConnection({ connectionId, auth }),
  connect: (connectionId: number, auth: AuthRequest) => backend().Connect({ connectionId, auth }),
  disconnect: (id: number) => backend().Disconnect(id),
  disconnectServer: (id: number) => backend().DisconnectServer(id),
  monitorSnapshot: (id: number) => backend().GetMonitorSnapshot(id),
  listNetworkInterfaces: (serverID: number) => backend().ListNetworkInterfaces({ serverID }),
  getMonitorNetworkInterface: (serverID: number) => backend().GetMonitorNetworkInterface(serverID),
  setMonitorNetworkInterface: (request: SetMonitorNetworkInterfaceRequest) =>
    backend().SetMonitorNetworkInterface(request),
  startNetworkDiagnostic: (request: StartNetworkDiagnosticRequest) =>
    backend().StartNetworkDiagnostic(request),
  cancelNetworkDiagnostic: (request: CancelNetworkDiagnosticRequest) =>
    backend().CancelNetworkDiagnostic(request),
  listNetworkDiagnosticTasks: (serverID: number) => backend().ListNetworkDiagnosticTasks(serverID),
  openNetworkInspectionContext: (serverID: number) =>
    backend().OpenNetworkInspectionContext({ serverID }),
  getNetworkEndpointSnapshot: (request: NetworkEndpointSnapshotRequest) =>
    backend().GetNetworkEndpointSnapshot(request),
  closeNetworkInspectionContext: (request: CloseNetworkInspectionContextRequest) =>
    backend().CloseNetworkInspectionContext(request),
  listProcesses: (request: ListProcessesRequest) => backend().ListProcesses(request),
  getProcessDetail: (request: GetProcessDetailRequest) => backend().GetProcessDetail(request),
  signalProcess: (request: SignalProcessRequest) => backend().SignalProcess(request),
  startProcessWatch: (request: StartProcessWatchRequest) => backend().StartProcessWatch(request),
  stopProcessWatch: (request: StopProcessWatchRequest) => backend().StopProcessWatch(request),
  connectionState: (id: number) => backend().GetConnectionState(id),
  settings: () => backend().GetSettings(),
  appVersion: () => backend().GetAppVersion(),
  defaultSettings: () => backend().GetDefaultSettings(),
  saveSettings: (settings: AppSettings) => backend().SaveSettings(settings),
  checkShortcutConflicts: (request: ShortcutConflictCheckRequest) => backend().CheckShortcutConflicts(request),
  persistWindowState: () => backend().PersistWindowState(),
  beginAlertSession: (sessionID: string, historyLimit: number) =>
    backend().BeginAlertSession({ sessionID, historyLimit }),
  listAlertHistory: (limit: number) => backend().ListAlertHistory({ limit }),
  persistAlertHistoryEvent: (event: AlertEvent, historyLimit: number) =>
    backend().PersistAlertHistoryEvent({ event, historyLimit }),
  markAlertHistoryRead: (eventID: string) => backend().MarkAlertHistoryRead({ eventID }),
  markAllAlertHistoryRead: () => backend().MarkAllAlertHistoryRead({}),
  clearResolvedAlertHistory: () => backend().ClearResolvedAlertHistory({}),
  listTerminalProfiles: () => backend().ListTerminalProfiles(),
  createTerminalProfile: (request: SaveTerminalProfileRequest) =>
    backend().CreateTerminalProfile(request),
  updateTerminalProfile: (request: SaveTerminalProfileRequest) =>
    backend().UpdateTerminalProfile(request),
  duplicateTerminalProfile: (id: string) => backend().DuplicateTerminalProfile(id),
  deleteTerminalProfile: (request: DeleteTerminalProfileRequest) => backend().DeleteTerminalProfile(request),
  setDefaultTerminalProfile: (id: string) => backend().SetDefaultTerminalProfile(id),
  assignServerTerminalProfile: (request: AssignServerTerminalProfileRequest) =>
    backend().AssignServerTerminalProfile(request),
  resolvedTerminalProfile: (serverID = 0) => backend().GetResolvedTerminalProfile({ serverID }),
  getLocalTerminalCapabilities: () => backend().GetLocalTerminalCapabilities(),
  getLocalResourceSnapshot: () => backend().GetLocalResourceSnapshot(),
  getLocalExplorerHome: () => backend().GetLocalExplorerHome(),
  getLocalDrives: () => backend().GetLocalDrives(),
  listLocalDirectory: (path: string) => backend().ListLocalDirectory({ path }),
  openLocalPath: (path: string) => backend().OpenLocalPath({ path }),
  revealLocalPath: (path: string) => backend().RevealLocalPath({ path }),
  showLocalPathProperties: (path: string) => backend().ShowLocalPathProperties({ path }),
  getStartupLocalTerminalRequest: () => backend().GetStartupLocalTerminalRequest(),
  relaunchElevatedLocalTerminal: (request: LocalTerminalElevatedRelaunchRequest) =>
    backend().RelaunchElevatedLocalTerminal(request),
  probeConnectionReachability: (id: number) => backend().ProbeConnectionReachability(id),
  probeHostKey: (id: number) => backend().ProbeHostKey(id),
  trustHostKey: (connectionId: number, expectedFingerprint: string) =>
    backend().TrustHostKey({ connectionId, expectedFingerprint }),
  listLogs: (limit = 500) => backend().ListLogs(limit),
  logFrontendError,
  selectPrivateKeyFile: () => backend().SelectPrivateKeyFile(),
  selectBackupExportPath: () => backend().SelectBackupExportPath(),
  selectBackupImportFile: () => backend().SelectBackupImportFile(),
  exportBackup: (request: BackupExportRequest) => backend().ExportBackup(request),
  inspectBackup: (request: BackupInspectRequest) => backend().InspectBackup(request),
  importBackup: (request: BackupImportRequest) => backend().ImportBackup(request),
  listTunnelProfiles: () => backend().ListTunnelProfiles(),
  createTunnelProfile: (request: SaveTunnelProfileRequest) => backend().CreateTunnelProfile(request),
  updateTunnelProfile: (request: SaveTunnelProfileRequest) => backend().UpdateTunnelProfile(request),
  deleteTunnelProfile: (id: number) => backend().DeleteTunnelProfile(id),
  listTunnels: (serverID = 0) => backend().ListTunnels({ serverID }),
  startTunnel: (request: StartTunnelRequest) => backend().StartTunnel(request),
  stopTunnel: (serverID: number, tunnelID: string) => backend().StopTunnel({ serverID, tunnelID }),
  restartTunnel: (request: RestartTunnelRequest) => backend().RestartTunnel(request),
  tunnelState: (tunnelID: string) => backend().GetTunnelState(tunnelID),
  checkTunnelRemoteListen: (serverID: number, tunnelID: string) =>
    backend().CheckTunnelRemoteListen({ serverID, tunnelID }),
  inspectRemoteForwardAccess: (request: RemoteForwardAccessRequest) =>
    backend().InspectRemoteForwardAccess(request),
  enableRemoteForwardAccess: (request: RemoteForwardAccessRequest) =>
    backend().EnableRemoteForwardAccess(request),
  enableRemoteForwardAccessAndRestart: (request: RemoteForwardAccessRestartRequest) =>
    backend().EnableRemoteForwardAccessAndRestart(request),
  dockerCheck: (serverID: number) => backend().DockerCheck(serverID),
  dockerListContainers: (serverID: number) => backend().DockerListContainers({ serverID }),
  dockerStartContainer: (serverID: number, containerID: string) =>
    backend().DockerStartContainer({ serverID, containerID }),
  dockerStopContainer: (serverID: number, containerID: string) =>
    backend().DockerStopContainer({ serverID, containerID }),
  dockerRestartContainer: (serverID: number, containerID: string) =>
    backend().DockerRestartContainer({ serverID, containerID }),
  dockerRemoveContainer: (serverID: number, containerID: string) =>
    backend().DockerRemoveContainer({ serverID, containerID }),
  dockerBatchStartContainers: (serverID: number, containerIDs: string[]) =>
    backend().DockerBatchStartContainers({ serverID, containerIDs }),
  dockerBatchStopContainers: (serverID: number, containerIDs: string[]) =>
    backend().DockerBatchStopContainers({ serverID, containerIDs }),
  dockerBatchRestartContainers: (serverID: number, containerIDs: string[]) =>
    backend().DockerBatchRestartContainers({ serverID, containerIDs }),
  dockerBatchRemoveContainers: (serverID: number, containerIDs: string[]) =>
    backend().DockerBatchRemoveContainers({ serverID, containerIDs }),
  dockerGetContainerLogs: (serverID: number, containerID: string, tailLines = 200) =>
    backend().DockerGetContainerLogs({ serverID, containerID, tailLines }),
  dockerStartLogStream: (serverID: number, containerID: string, tailLines = 200, streamID = '') =>
    backend().DockerStartLogStream({ serverID, containerID, tailLines, streamID }),
  dockerStopLogStream: (serverID: number, streamID: string) =>
    backend().DockerStopLogStream({ serverID, streamID }),
  dockerGetContainerInspectSummary: (serverID: number, containerID: string) =>
    backend().DockerGetContainerInspectSummary({ serverID, containerID }),
  dockerGetContainerStats: (serverID: number, containerID: string) =>
    backend().DockerGetContainerStats({ serverID, containerID }),
  dockerStartStatsWatch: (serverID: number, containerID: string, intervalMs = 1500, watchID = '') =>
    backend().DockerStartStatsWatch({ serverID, containerID, intervalMs, watchID }),
  dockerStopStatsWatch: (serverID: number, watchID: string) =>
    backend().DockerStopStatsWatch({ serverID, watchID }),
  dockerComposeCheck: (serverID: number) => backend().DockerComposeCheck(serverID),
  dockerComposeListProjects: (serverID: number) => backend().DockerComposeListProjects({ serverID }),
  dockerComposeGetServices: (serverID: number, projectName: string) =>
    backend().DockerComposeGetServices({ serverID, projectName }),
  dockerComposeGetServiceDetail: (serverID: number, projectName: string, serviceName: string) =>
    backend().DockerComposeGetServiceDetail({ serverID, projectName, serviceName }),
  dockerComposeGetLogs: (serverID: number, projectName: string, tailLines = 200, serviceName = '') =>
    backend().DockerComposeGetLogs({ serverID, projectName, tailLines, serviceName }),
  checkServiceManager: (serverID: number) => backend().CheckServiceManager({ serverID }),
  listSystemServices: (serverID: number) => backend().ListSystemServices({ serverID }),
  getSystemServiceDetail: (serverID: number, unitName: string, serviceID = unitName) =>
    backend().GetSystemServiceDetail({ serverID, unitName, serviceID }),
  startSystemService: (serverID: number, unitName: string, serviceID = unitName) =>
    backend().StartSystemService({ serverID, unitName, serviceID }),
  stopSystemService: (serverID: number, unitName: string, serviceID = unitName) =>
    backend().StopSystemService({ serverID, unitName, serviceID }),
  restartSystemService: (serverID: number, unitName: string, serviceID = unitName) =>
    backend().RestartSystemService({ serverID, unitName, serviceID }),
  enableSystemService: (serverID: number, unitName: string, serviceID = unitName) =>
    backend().EnableSystemService({ serverID, unitName, serviceID }),
  disableSystemService: (serverID: number, unitName: string, serviceID = unitName) =>
    backend().DisableSystemService({ serverID, unitName, serviceID }),
  cancelSystemServiceRequests: (serverID: number) =>
    backend().CancelSystemServiceRequests({ serverID }),
  getSystemServiceJournal: (request: SystemServiceJournalRequest) =>
    backend().GetSystemServiceJournal(request),
  startSystemServiceJournalFollow: (request: SystemServiceJournalRequest) =>
    backend().StartSystemServiceJournalFollow(request),
  stopSystemServiceJournalFollow: (serverID: number, watchID: string) =>
    backend().StopSystemServiceJournalFollow({ serverID, watchID }),
  listCommandHistory: (request: ListCommandHistoryRequest) => backend().ListCommandHistory(request),
  recordCommandHistory: (request: RecordCommandHistoryRequest) => backend().RecordCommandHistory(request),
  recordBatchCommandHistory: (request: RecordBatchCommandHistoryRequest) =>
    backend().RecordBatchCommandHistory(request),
  updateCommandHistory: (request: UpdateCommandHistoryRequest) => backend().UpdateCommandHistory(request),
  deleteCommandHistory: (id: string) => backend().DeleteCommandHistory(id),
  clearCommandHistory: (serverId: number) => backend().ClearCommandHistory(serverId),
  listCommandFavorites: (request: ListCommandFavoritesRequest) => backend().ListCommandFavorites(request),
  createCommandFavorite: (request: SaveCommandFavoriteRequest) => backend().CreateCommandFavorite(request),
  updateCommandFavorite: (request: SaveCommandFavoriteRequest) => backend().UpdateCommandFavorite(request),
  deleteCommandFavorite: (id: string) => backend().DeleteCommandFavorite(id),
  incrementCommandFavoriteUse: (id: string) => backend().IncrementCommandFavoriteUse(id),
  listCommandSuggestions: (request: ListCommandSuggestionsRequest) => backend().ListCommandSuggestions(request),
  startBatchCommand: (request: StartBatchCommandRequest) => backend().StartBatchCommand(request),
  cancelBatchCommandServer: (request: CancelBatchCommandServerRequest) =>
    backend().CancelBatchCommandServer(request),
  cancelBatchCommandTask: (request: CancelBatchCommandTaskRequest) =>
    backend().CancelBatchCommandTask(request),
  getBatchCommandTask: (taskID: string) => backend().GetBatchCommandTask(taskID),
  listBatchCommandTasks: () => backend().ListBatchCommandTasks(),
  clearBatchCommandTask: (taskID: string) => backend().ClearBatchCommandTask(taskID),
  authenticationState: (id: number) => backend().GetAuthenticationState(id),
  resetHostKeyTrust: (id: number) => backend().ResetHostKeyTrust(id),
  openTerminal: (connectionId: number, auth: AuthRequest, columns: number, rows: number) =>
    backend().OpenTerminal({ connectionId, auth, columns, rows }),
  writeTerminal: (sessionId: string, dataBase64: string) =>
    backend().WriteTerminal({ sessionId, dataBase64 }),
  resizeTerminal: (sessionId: string, columns: number, rows: number) =>
    backend().ResizeTerminal({ sessionId, columns, rows }),
  closeTerminal: (sessionId: string) => backend().CloseTerminal(sessionId),
  reconnectTerminal: (sessionId: string, connectionId: number, auth: AuthRequest, columns: number, rows: number) =>
    backend().ReconnectTerminal({ sessionId, connectionId, auth, columns, rows }),
  openLocalTerminal: (request: LocalTerminalOpenRequest) => backend().OpenLocalTerminal(request),
  writeLocalTerminal: (sessionId: string, dataBase64: string) =>
    backend().WriteLocalTerminal({ sessionId, dataBase64 }),
  resizeLocalTerminal: (sessionId: string, columns: number, rows: number) =>
    backend().ResizeLocalTerminal({ sessionId, cols: columns, rows }),
  closeLocalTerminal: (sessionId: string) => backend().CloseLocalTerminal(sessionId),
  listLocalTerminals: () => backend().ListLocalTerminals(),
  localTerminalState: (sessionId: string) => backend().GetLocalTerminalState(sessionId),
  openSftp: (connectionId: number, auth: AuthRequest, contextId?: string, terminalSessionId?: string) =>
    backend().OpenSftp({ connectionId, contextId, terminalSessionId, auth }),
  reconnectSftp: (connectionId: number, auth: AuthRequest, contextId?: string, terminalSessionId?: string) =>
    backend().ReconnectSftp({ connectionId, contextId, terminalSessionId, auth }),
  closeSftp: (connectionId: number) => backend().CloseSftp(connectionId),
  closeSftpContext: (connectionId: number, contextId: string, terminalSessionId?: string) =>
    backend().CloseSftpContext({ connectionId, contextId, terminalSessionId }),
  sftpState: (connectionId: number) => backend().GetSftpState(connectionId),
  sftpContextState: (connectionId: number, contextId: string, terminalSessionId?: string) =>
    backend().GetSftpContextState({ connectionId, contextId, terminalSessionId }),
  readSftpDir: (connectionId: number, path: string, contextId?: string, terminalSessionId?: string, requestId?: string) =>
    backend().ReadSftpDir({ connectionId, contextId, terminalSessionId, path, requestId }),
  sftpGoHome: (connectionId: number, contextId?: string, terminalSessionId?: string, requestId?: string) =>
    backend().SftpGoHome({ connectionId, contextId, terminalSessionId, requestId }),
  sftpGoParent: (connectionId: number, contextId?: string, terminalSessionId?: string, requestId?: string) =>
    backend().SftpGoParent({ connectionId, contextId, terminalSessionId, requestId }),
  sftpMkdir: (connectionId: number, path: string, contextId?: string, terminalSessionId?: string) =>
    backend().SftpMkdir({ connectionId, contextId, terminalSessionId, path }),
  sftpRename: (connectionId: number, oldPath: string, newPath: string, contextId?: string, terminalSessionId?: string) =>
    backend().SftpRename({ connectionId, contextId, terminalSessionId, oldPath, newPath }),
  sftpDelete: (connectionId: number, path: string, isDir: boolean, contextId?: string, terminalSessionId?: string) =>
    backend().SftpDelete({ connectionId, contextId, terminalSessionId, path, isDir }),
  sftpInspectDelete: (connectionId: number, paths: string[], recursive: boolean, contextId?: string, terminalSessionId?: string) =>
    backend().SftpInspectDelete({ connectionId, contextId, terminalSessionId, paths, recursive }),
  sftpDeletePaths: (connectionId: number, paths: string[], recursive: boolean, contextId?: string, terminalSessionId?: string) =>
    backend().SftpDelete({ connectionId, contextId, terminalSessionId, paths, recursive }),
  sftpStat: (connectionId: number, path: string, contextId?: string, terminalSessionId?: string) =>
    backend().SftpStat({ connectionId, contextId, terminalSessionId, path }),
  sftpGetRemoteItemProperties: (connectionId: number, path: string, contextId?: string, terminalSessionId?: string, generation?: number, requestId?: string) =>
    backend().SftpGetRemoteItemProperties({ connectionId, contextId, terminalSessionId, generation, requestId, path }),
  sftpUpdateRemoteItemPermissions: (connectionId: number, path: string, mode: number, preserveSpecialBits: boolean, contextId?: string, terminalSessionId?: string, generation?: number, requestId?: string) =>
    backend().SftpUpdateRemoteItemPermissions({ connectionId, contextId, terminalSessionId, generation, requestId, path, mode, preserveSpecialBits }),
  sftpReadTextFile: (connectionId: number, path: string, maxBytes = 2 * 1024 * 1024, contextId?: string, terminalSessionId?: string, requestId?: string) =>
    backend().SftpReadTextFile({ connectionId, contextId, terminalSessionId, path, maxBytes, requestId }),
  sftpWriteTextFile: (
    connectionId: number,
    path: string,
    content: string,
    expectedSize: number,
    expectedMTime: string,
    forceOverwrite = false,
    contextId?: string,
    terminalSessionId?: string,
    encoding = 'utf-8',
    generation = 0,
    requestId = '',
    expectedHash = '',
    mode: SFTPTextSaveMode = 'save_existing',
    conflictPolicy: SFTPTextConflictPolicy = forceOverwrite ? 'overwrite' : 'fail_if_changed',
  ) => backend().SftpWriteTextFile({
    connectionId,
    contextId,
    terminalSessionId,
    path,
    content,
    expectedSize,
    expectedMTime,
    expectedHash,
    encoding,
    generation,
    requestId,
    mode,
    conflictPolicy,
    forceOverwrite,
  }),
  sftpUpload: (connectionId: number, localPath: string, remotePath: string, conflictPolicy: SFTPConflictPolicy, contextId?: string, terminalSessionId?: string) =>
    backend().SftpUpload({ connectionId, contextId, terminalSessionId, localPath, remotePath, conflictPolicy }),
  sftpDownload: (connectionId: number, localPath: string, remotePath: string, conflictPolicy: SFTPConflictPolicy, contextId?: string, terminalSessionId?: string) =>
    backend().SftpDownload({ connectionId, contextId, terminalSessionId, localPath, remotePath, conflictPolicy }),
  sftpUploadDirectory: (connectionId: number, localPath: string, remoteDirectory: string, conflictPolicy: SFTPConflictPolicy, contextId?: string, terminalSessionId?: string) =>
    backend().SftpUploadDirectory({ connectionId, contextId, terminalSessionId, localPath, remoteDirectory, conflictPolicy }),
  sftpDownloadDirectory: (connectionId: number, remotePath: string, localDirectory: string, conflictPolicy: SFTPConflictPolicy, contextId?: string, terminalSessionId?: string) =>
    backend().SftpDownloadDirectory({ connectionId, contextId, terminalSessionId, remotePath, localDirectory, conflictPolicy }),
  sftpCancelTransfer: (transferId: string, contextId?: string) => backend().SftpCancelTransfer({ transferId, contextId }),
  sftpPauseTransfer: (connectionId: number, contextId: string, transferId: string) =>
    backend().SftpPauseTransfer({ serverID: connectionId, contextID: contextId, transferID: transferId }),
  sftpResumeTransfer: (connectionId: number, contextId: string, transferId: string) =>
    backend().SftpResumeTransfer({ serverID: connectionId, contextID: contextId, transferID: transferId }),
  selectLocalUploadFiles: () => backend().SelectLocalUploadFiles(),
  selectLocalUploadDirectory: () => backend().SelectLocalUploadDirectory(),
  selectLocalDownloadDirectory: () => backend().SelectLocalDownloadDirectory(),
}

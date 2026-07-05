export namespace domain {

	export class AlertHistoryEvent {
	    eventID: string;
	    serverID: number;
	    serverName: string;
	    ruleType: string;
	    severity: string;
	    state: string;
	    source: string;
	    currentValue?: number;
	    threshold?: number;
	    unit?: string;
	    title: string;
	    message: string;
	    startedAt: string;
	    resolvedAt?: string;
	    read: boolean;
	    readAt?: string;
	    muted: boolean;
	    sessionID?: string;
	    endedReason?: string;
	    createdAt?: string;
	    updatedAt?: string;

	    static createFrom(source: any = {}) {
	        return new AlertHistoryEvent(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.eventID = source["eventID"];
	        this.serverID = source["serverID"];
	        this.serverName = source["serverName"];
	        this.ruleType = source["ruleType"];
	        this.severity = source["severity"];
	        this.state = source["state"];
	        this.source = source["source"];
	        this.currentValue = source["currentValue"];
	        this.threshold = source["threshold"];
	        this.unit = source["unit"];
	        this.title = source["title"];
	        this.message = source["message"];
	        this.startedAt = source["startedAt"];
	        this.resolvedAt = source["resolvedAt"];
	        this.read = source["read"];
	        this.readAt = source["readAt"];
	        this.muted = source["muted"];
	        this.sessionID = source["sessionID"];
	        this.endedReason = source["endedReason"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class AlertHistoryPersistResult {
	    persisted: boolean;
	    skipped: boolean;
	    reasonCode: string;

	    static createFrom(source: any = {}) {
	        return new AlertHistoryPersistResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.persisted = source["persisted"];
	        this.skipped = source["skipped"];
	        this.reasonCode = source["reasonCode"];
	    }
	}
	export class NativeAlertNotificationSettings {
	    enabled: boolean;

	    static createFrom(source: any = {}) {
	        return new NativeAlertNotificationSettings(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	    }
	}
	export class ThresholdAlertRuleSettings {
	    enabled: boolean;
	    threshold: number;
	    durationSeconds: number;

	    static createFrom(source: any = {}) {
	        return new ThresholdAlertRuleSettings(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.threshold = source["threshold"];
	        this.durationSeconds = source["durationSeconds"];
	    }
	}
	export class OfflineAlertRuleSettings {
	    enabled: boolean;
	    graceSeconds: number;

	    static createFrom(source: any = {}) {
	        return new OfflineAlertRuleSettings(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.graceSeconds = source["graceSeconds"];
	    }
	}
	export class AlertSettings {
	    enabled: boolean;
	    notifyRecovery: boolean;
	    historyLimit: number;
	    offline: OfflineAlertRuleSettings;
	    cpu: ThresholdAlertRuleSettings;
	    memory: ThresholdAlertRuleSettings;
	    rootDisk: ThresholdAlertRuleSettings;
	    latency: ThresholdAlertRuleSettings;
	    nativeNotifications: NativeAlertNotificationSettings;

	    static createFrom(source: any = {}) {
	        return new AlertSettings(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.notifyRecovery = source["notifyRecovery"];
	        this.historyLimit = source["historyLimit"];
	        this.offline = this.convertValues(source["offline"], OfflineAlertRuleSettings);
	        this.cpu = this.convertValues(source["cpu"], ThresholdAlertRuleSettings);
	        this.memory = this.convertValues(source["memory"], ThresholdAlertRuleSettings);
	        this.rootDisk = this.convertValues(source["rootDisk"], ThresholdAlertRuleSettings);
	        this.latency = this.convertValues(source["latency"], ThresholdAlertRuleSettings);
	        this.nativeNotifications = this.convertValues(source["nativeNotifications"], NativeAlertNotificationSettings);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BackupImportOptions {
	    importSettings: boolean;
	    importGroups: boolean;
	    importServers: boolean;
	    importKeyVault: boolean;
	    importHostTrust: boolean;

	    static createFrom(source: any = {}) {
	        return new BackupImportOptions(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.importSettings = source["importSettings"];
	        this.importGroups = source["importGroups"];
	        this.importServers = source["importServers"];
	        this.importKeyVault = source["importKeyVault"];
	        this.importHostTrust = source["importHostTrust"];
	    }
	}
	export class ShortcutSettings {
	    terminalCopyOnSelectEnabled: boolean;
	    terminalRightClickAction: string;
	    terminalContextMenuTrigger: string;
	    terminalCopy: string;
	    terminalPaste: string;
	    terminalCompletion: string;
	    openCommandHistory: string;
	    openCommandFavorites: string;

	    static createFrom(source: any = {}) {
	        return new ShortcutSettings(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.terminalCopyOnSelectEnabled = source["terminalCopyOnSelectEnabled"];
	        this.terminalRightClickAction = source["terminalRightClickAction"];
	        this.terminalContextMenuTrigger = source["terminalContextMenuTrigger"];
	        this.terminalCopy = source["terminalCopy"];
	        this.terminalPaste = source["terminalPaste"];
	        this.terminalCompletion = source["terminalCompletion"];
	        this.openCommandHistory = source["openCommandHistory"];
	        this.openCommandFavorites = source["openCommandFavorites"];
	    }
	}
	export class AppSettings {
	    defaultRememberPassword: boolean;
	    defaultRememberPassphrase: boolean;
	    terminalCopyOnSelectEnabled: boolean;
	    terminalRightClickPasteEnabled: boolean;
	    shortcutSettings: ShortcutSettings;
	    hostKeyPolicy: string;
	    themeMode: string;
	    uiFontSize: string;
	    localTerminalShellPreference: string;
	    localTerminalElevatedEnabled: boolean;
	    defaultTerminalProfileId: string;
	    commandHistoryMaxEntries: number;
	    sshKeepaliveEnabled: boolean;
	    sshKeepaliveIntervalSeconds: number;
	    sshKeepaliveTimeoutSeconds: number;
	    sshKeepaliveMaxFailures: number;
	    connectionTimeoutSeconds: number;
	    dashboardSortMode: string;
	    dashboardManualServerOrder: string[];
	    alerts: AlertSettings;
	    backupImportOptions: BackupImportOptions;
	    windowWidth: number;
	    windowHeight: number;
	    windowMaximized: boolean;
	    settingsVersion: number;
	    onboardingCompleted: boolean;
	    trustOnFirstUseAcknowledged: boolean;

	    static createFrom(source: any = {}) {
	        return new AppSettings(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.defaultRememberPassword = source["defaultRememberPassword"];
	        this.defaultRememberPassphrase = source["defaultRememberPassphrase"];
	        this.terminalCopyOnSelectEnabled = source["terminalCopyOnSelectEnabled"];
	        this.terminalRightClickPasteEnabled = source["terminalRightClickPasteEnabled"];
	        this.shortcutSettings = this.convertValues(source["shortcutSettings"], ShortcutSettings);
	        this.hostKeyPolicy = source["hostKeyPolicy"];
	        this.themeMode = source["themeMode"];
	        this.uiFontSize = source["uiFontSize"];
	        this.localTerminalShellPreference = source["localTerminalShellPreference"];
	        this.localTerminalElevatedEnabled = source["localTerminalElevatedEnabled"];
	        this.defaultTerminalProfileId = source["defaultTerminalProfileId"];
	        this.commandHistoryMaxEntries = source["commandHistoryMaxEntries"];
	        this.sshKeepaliveEnabled = source["sshKeepaliveEnabled"];
	        this.sshKeepaliveIntervalSeconds = source["sshKeepaliveIntervalSeconds"];
	        this.sshKeepaliveTimeoutSeconds = source["sshKeepaliveTimeoutSeconds"];
	        this.sshKeepaliveMaxFailures = source["sshKeepaliveMaxFailures"];
	        this.connectionTimeoutSeconds = source["connectionTimeoutSeconds"];
	        this.dashboardSortMode = source["dashboardSortMode"];
	        this.dashboardManualServerOrder = source["dashboardManualServerOrder"];
	        this.alerts = this.convertValues(source["alerts"], AlertSettings);
	        this.backupImportOptions = this.convertValues(source["backupImportOptions"], BackupImportOptions);
	        this.windowWidth = source["windowWidth"];
	        this.windowHeight = source["windowHeight"];
	        this.windowMaximized = source["windowMaximized"];
	        this.settingsVersion = source["settingsVersion"];
	        this.onboardingCompleted = source["onboardingCompleted"];
	        this.trustOnFirstUseAcknowledged = source["trustOnFirstUseAcknowledged"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AppVersionInfo {
	    version: string;

	    static createFrom(source: any = {}) {
	        return new AppVersionInfo(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	    }
	}
	export class AssignServerTerminalProfileRequest {
	    serverID: number;
	    terminalProfileId?: string;

	    static createFrom(source: any = {}) {
	        return new AssignServerTerminalProfileRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.terminalProfileId = source["terminalProfileId"];
	    }
	}
	export class AuthRequest {
	    password: string;
	    passphrase: string;
	    trustUnknownHost: boolean;
	    rememberSecret: boolean;
	    secretUpdateMode?: string;

	    static createFrom(source: any = {}) {
	        return new AuthRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.password = source["password"];
	        this.passphrase = source["passphrase"];
	        this.trustUnknownHost = source["trustUnknownHost"];
	        this.rememberSecret = source["rememberSecret"];
	        this.secretUpdateMode = source["secretUpdateMode"];
	    }
	}
	export class AuthenticationState {
	    connectionId: number;
	    canAuthenticate: boolean;
	    credentialSaved: boolean;
	    credentialUsable: boolean;
	    privateKeyEncrypted: boolean;
	    hostTrusted: boolean;
	    reasonCode: string;
	    message: string;

	    static createFrom(source: any = {}) {
	        return new AuthenticationState(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.canAuthenticate = source["canAuthenticate"];
	        this.credentialSaved = source["credentialSaved"];
	        this.credentialUsable = source["credentialUsable"];
	        this.privateKeyEncrypted = source["privateKeyEncrypted"];
	        this.hostTrusted = source["hostTrusted"];
	        this.reasonCode = source["reasonCode"];
	        this.message = source["message"];
	    }
	}
	export class BackupConflict {
	    kind: string;
	    name: string;
	    message: string;

	    static createFrom(source: any = {}) {
	        return new BackupConflict(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.message = source["message"];
	    }
	}
	export class BackupExportRequest {
	    path: string;
	    password: string;
	    confirmPassword: string;
	    mode: string;

	    static createFrom(source: any = {}) {
	        return new BackupExportRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.password = source["password"];
	        this.confirmPassword = source["confirmPassword"];
	        this.mode = source["mode"];
	    }
	}
	export class BackupExportResult {
	    path: string;
	    createdAt: string;
	    mode: string;
	    groups: number;
	    connections: number;
	    keyVaultEntries: number;
	    hostTrustRecords: number;
	    secretEntries: number;
	    encryptedFileSize: number;

	    static createFrom(source: any = {}) {
	        return new BackupExportResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.createdAt = source["createdAt"];
	        this.mode = source["mode"];
	        this.groups = source["groups"];
	        this.connections = source["connections"];
	        this.keyVaultEntries = source["keyVaultEntries"];
	        this.hostTrustRecords = source["hostTrustRecords"];
	        this.secretEntries = source["secretEntries"];
	        this.encryptedFileSize = source["encryptedFileSize"];
	    }
	}

	export class BackupImportRequest {
	    path: string;
	    password: string;
	    options: BackupImportOptions;

	    static createFrom(source: any = {}) {
	        return new BackupImportRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.password = source["password"];
	        this.options = this.convertValues(source["options"], BackupImportOptions);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BackupWarning {
	    code: string;
	    message: string;

	    static createFrom(source: any = {}) {
	        return new BackupWarning(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.message = source["message"];
	    }
	}
	export class BackupImportResult {
	    groupsAdded: number;
	    connectionsAdded: number;
	    keyVaultAdded: number;
	    hostTrustImported: number;
	    secretsRestored: number;
	    skipped: number;
	    renamed: number;
	    warnings: BackupWarning[];
	    credentialsNotice: string;

	    static createFrom(source: any = {}) {
	        return new BackupImportResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.groupsAdded = source["groupsAdded"];
	        this.connectionsAdded = source["connectionsAdded"];
	        this.keyVaultAdded = source["keyVaultAdded"];
	        this.hostTrustImported = source["hostTrustImported"];
	        this.secretsRestored = source["secretsRestored"];
	        this.skipped = source["skipped"];
	        this.renamed = source["renamed"];
	        this.warnings = this.convertValues(source["warnings"], BackupWarning);
	        this.credentialsNotice = source["credentialsNotice"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BackupInspectRequest {
	    path: string;
	    password: string;

	    static createFrom(source: any = {}) {
	        return new BackupInspectRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.password = source["password"];
	    }
	}
	export class BackupPreview {
	    format: string;
	    version: number;
	    createdAt: string;
	    exportedAt: string;
	    schemaVersion: number;
	    settingsCount: number;
	    groupCount: number;
	    connectionCount: number;
	    keyVaultCount: number;
	    hostTrustCount: number;
	    missingPrivateKeyPath: number;
	    conflictCount: number;
	    warnings: BackupWarning[];
	    conflicts: BackupConflict[];
	    credentialsNotice: string;

	    static createFrom(source: any = {}) {
	        return new BackupPreview(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.format = source["format"];
	        this.version = source["version"];
	        this.createdAt = source["createdAt"];
	        this.exportedAt = source["exportedAt"];
	        this.schemaVersion = source["schemaVersion"];
	        this.settingsCount = source["settingsCount"];
	        this.groupCount = source["groupCount"];
	        this.connectionCount = source["connectionCount"];
	        this.keyVaultCount = source["keyVaultCount"];
	        this.hostTrustCount = source["hostTrustCount"];
	        this.missingPrivateKeyPath = source["missingPrivateKeyPath"];
	        this.conflictCount = source["conflictCount"];
	        this.warnings = this.convertValues(source["warnings"], BackupWarning);
	        this.conflicts = this.convertValues(source["conflicts"], BackupConflict);
	        this.credentialsNotice = source["credentialsNotice"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class BatchCommandServerResult {
	    taskID: string;
	    serverID: number;
	    serverName: string;
	    host: string;
	    status: string;
	    exitCode: number;
	    stdout: string;
	    stderr: string;
	    startedAt?: string;
	    completedAt?: string;
	    durationMs: number;
	    error: string;
	    outputTruncated: boolean;

	    static createFrom(source: any = {}) {
	        return new BatchCommandServerResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.taskID = source["taskID"];
	        this.serverID = source["serverID"];
	        this.serverName = source["serverName"];
	        this.host = source["host"];
	        this.status = source["status"];
	        this.exitCode = source["exitCode"];
	        this.stdout = source["stdout"];
	        this.stderr = source["stderr"];
	        this.startedAt = source["startedAt"];
	        this.completedAt = source["completedAt"];
	        this.durationMs = source["durationMs"];
	        this.error = source["error"];
	        this.outputTruncated = source["outputTruncated"];
	    }
	}
	export class BatchCommandTask {
	    taskID: string;
	    command: string;
	    serverIDs: number[];
	    status: string;
	    createdAt: string;
	    startedAt?: string;
	    completedAt?: string;
	    concurrency: number;
	    timeoutSeconds: number;
	    results: BatchCommandServerResult[];

	    static createFrom(source: any = {}) {
	        return new BatchCommandTask(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.taskID = source["taskID"];
	        this.command = source["command"];
	        this.serverIDs = source["serverIDs"];
	        this.status = source["status"];
	        this.createdAt = source["createdAt"];
	        this.startedAt = source["startedAt"];
	        this.completedAt = source["completedAt"];
	        this.concurrency = source["concurrency"];
	        this.timeoutSeconds = source["timeoutSeconds"];
	        this.results = this.convertValues(source["results"], BatchCommandServerResult);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BeginAlertSessionRequest {
	    sessionID: string;
	    historyLimit: number;

	    static createFrom(source: any = {}) {
	        return new BeginAlertSessionRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionID = source["sessionID"];
	        this.historyLimit = source["historyLimit"];
	    }
	}
	export class CancelBatchCommandServerRequest {
	    taskID: string;
	    serverID: number;

	    static createFrom(source: any = {}) {
	        return new CancelBatchCommandServerRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.taskID = source["taskID"];
	        this.serverID = source["serverID"];
	    }
	}
	export class CancelBatchCommandTaskRequest {
	    taskID: string;

	    static createFrom(source: any = {}) {
	        return new CancelBatchCommandTaskRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.taskID = source["taskID"];
	    }
	}
	export class CancelNetworkDiagnosticRequest {
	    serverID: number;
	    taskID: string;

	    static createFrom(source: any = {}) {
	        return new CancelNetworkDiagnosticRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.taskID = source["taskID"];
	    }
	}
	export class CheckTunnelRemoteListenRequest {
	    serverID: number;
	    tunnelID: string;

	    static createFrom(source: any = {}) {
	        return new CheckTunnelRemoteListenRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.tunnelID = source["tunnelID"];
	    }
	}
	export class ClearResolvedAlertHistoryRequest {


	    static createFrom(source: any = {}) {
	        return new ClearResolvedAlertHistoryRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);

	    }
	}
	export class CloseNetworkInspectionContextRequest {
	    serverID: number;
	    contextID: string;

	    static createFrom(source: any = {}) {
	        return new CloseNetworkInspectionContextRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.contextID = source["contextID"];
	    }
	}
	export class CommandFavorite {
	    id: string;
	    title: string;
	    command: string;
	    description: string;
	    scope: string;
	    serverId?: number;
	    serverName: string;
	    groupId?: number;
	    groupName: string;
	    tags: string[];
	    sortOrder: number;
	    useCount: number;
	    createdAt: string;
	    updatedAt: string;
	    lastUsedAt: string;

	    static createFrom(source: any = {}) {
	        return new CommandFavorite(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.command = source["command"];
	        this.description = source["description"];
	        this.scope = source["scope"];
	        this.serverId = source["serverId"];
	        this.serverName = source["serverName"];
	        this.groupId = source["groupId"];
	        this.groupName = source["groupName"];
	        this.tags = source["tags"];
	        this.sortOrder = source["sortOrder"];
	        this.useCount = source["useCount"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	        this.lastUsedAt = source["lastUsedAt"];
	    }
	}
	export class CommandHistoryEntry {
	    id: string;
	    serverId: number;
	    serverName: string;
	    sessionId: string;
	    command: string;
	    preview: string;
	    isMultiline: boolean;
	    commandHash: string;
	    source: string;
	    sourceLabel: string;
	    executedAt: string;
	    targetServerIds?: number[];
	    targetCount: number;
	    batchSubmissionId?: string;

	    static createFrom(source: any = {}) {
	        return new CommandHistoryEntry(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.serverId = source["serverId"];
	        this.serverName = source["serverName"];
	        this.sessionId = source["sessionId"];
	        this.command = source["command"];
	        this.preview = source["preview"];
	        this.isMultiline = source["isMultiline"];
	        this.commandHash = source["commandHash"];
	        this.source = source["source"];
	        this.sourceLabel = source["sourceLabel"];
	        this.executedAt = source["executedAt"];
	        this.targetServerIds = source["targetServerIds"];
	        this.targetCount = source["targetCount"];
	        this.batchSubmissionId = source["batchSubmissionId"];
	    }
	}
	export class CommandSuggestion {
	    id: string;
	    source: string;
	    kind: string;
	    title: string;
	    command: string;
	    description: string;
	    scope: string;
	    serverId?: number;
	    groupId?: number;
	    score: number;
	    useCount: number;
	    lastUsedAt: string;

	    static createFrom(source: any = {}) {
	        return new CommandSuggestion(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.source = source["source"];
	        this.kind = source["kind"];
	        this.title = source["title"];
	        this.command = source["command"];
	        this.description = source["description"];
	        this.scope = source["scope"];
	        this.serverId = source["serverId"];
	        this.groupId = source["groupId"];
	        this.score = source["score"];
	        this.useCount = source["useCount"];
	        this.lastUsedAt = source["lastUsedAt"];
	    }
	}
	export class ConnectRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    auth: AuthRequest;

	    static createFrom(source: any = {}) {
	        return new ConnectRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.auth = this.convertValues(source["auth"], AuthRequest);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Connection {
	    id: number;
	    groupId?: number;
	    sortOrder: number;
	    name: string;
	    host: string;
	    port: number;
	    username: string;
	    authType: string;
	    privateKeySource: string;
	    privateKeyPath: string;
	    keyVaultId?: number;
	    terminalProfileId?: string;
	    connectionMode: string;
	    jumpServerId?: number;
	    hostKeyFingerprint: string;
	    credentialSaved: boolean;
	    passwordCredentialSaved: boolean;
	    refreshInterval: number;
	    networkInterfaceMode: string;
	    selectedNetworkInterface: string;
	    networkInterfaceUserSelected: boolean;
	    createdAt: string;
	    updatedAt: string;

	    static createFrom(source: any = {}) {
	        return new Connection(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.groupId = source["groupId"];
	        this.sortOrder = source["sortOrder"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.authType = source["authType"];
	        this.privateKeySource = source["privateKeySource"];
	        this.privateKeyPath = source["privateKeyPath"];
	        this.keyVaultId = source["keyVaultId"];
	        this.terminalProfileId = source["terminalProfileId"];
	        this.connectionMode = source["connectionMode"];
	        this.jumpServerId = source["jumpServerId"];
	        this.hostKeyFingerprint = source["hostKeyFingerprint"];
	        this.credentialSaved = source["credentialSaved"];
	        this.passwordCredentialSaved = source["passwordCredentialSaved"];
	        this.refreshInterval = source["refreshInterval"];
	        this.networkInterfaceMode = source["networkInterfaceMode"];
	        this.selectedNetworkInterface = source["selectedNetworkInterface"];
	        this.networkInterfaceUserSelected = source["networkInterfaceUserSelected"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class ConnectionError {
	    code: string;
	    userMessage: string;
	    technicalMessage: string;
	    retryable: boolean;
	    serverId: number;
	    operation: string;
	    timestamp: string;
	    stage?: string;
	    credentialServerId?: number;
	    credentialServerName?: string;
	    credentialFromStore?: boolean;
	    expectedFingerprint?: string;
	    observedFingerprint?: string;

	    static createFrom(source: any = {}) {
	        return new ConnectionError(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.userMessage = source["userMessage"];
	        this.technicalMessage = source["technicalMessage"];
	        this.retryable = source["retryable"];
	        this.serverId = source["serverId"];
	        this.operation = source["operation"];
	        this.timestamp = source["timestamp"];
	        this.stage = source["stage"];
	        this.credentialServerId = source["credentialServerId"];
	        this.credentialServerName = source["credentialServerName"];
	        this.credentialFromStore = source["credentialFromStore"];
	        this.expectedFingerprint = source["expectedFingerprint"];
	        this.observedFingerprint = source["observedFingerprint"];
	    }
	}
	export class ConnectionReachabilityResult {
	    reachable: boolean;
	    connectionError?: ConnectionError;

	    static createFrom(source: any = {}) {
	        return new ConnectionReachabilityResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.reachable = source["reachable"];
	        this.connectionError = this.convertValues(source["connectionError"], ConnectionError);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ConnectionRuntimeState {
	    connectionId: number;
	    status: string;
	    monitorActive: boolean;
	    terminalActive: boolean;
	    terminalConnecting: boolean;
	    sftpActive: boolean;
	    connecting: boolean;
	    hasActiveSession: boolean;
	    lastError?: ConnectionError;
	    updatedAt: string;

	    static createFrom(source: any = {}) {
	        return new ConnectionRuntimeState(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.status = source["status"];
	        this.monitorActive = source["monitorActive"];
	        this.terminalActive = source["terminalActive"];
	        this.terminalConnecting = source["terminalConnecting"];
	        this.sftpActive = source["sftpActive"];
	        this.connecting = source["connecting"];
	        this.hasActiveSession = source["hasActiveSession"];
	        this.lastError = this.convertValues(source["lastError"], ConnectionError);
	        this.updatedAt = source["updatedAt"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DeleteKeyVaultEntryRequest {
	    id: number;
	    forceUnbind: boolean;

	    static createFrom(source: any = {}) {
	        return new DeleteKeyVaultEntryRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.forceUnbind = source["forceUnbind"];
	    }
	}
	export class DeleteKeyVaultEntryResponse {
	    deleted: boolean;
	    requiresConfirmation: boolean;
	    unboundServerCount: number;
	    unboundServerNames: string[];
	    secretCleanupWarning: string;

	    static createFrom(source: any = {}) {
	        return new DeleteKeyVaultEntryResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.deleted = source["deleted"];
	        this.requiresConfirmation = source["requiresConfirmation"];
	        this.unboundServerCount = source["unboundServerCount"];
	        this.unboundServerNames = source["unboundServerNames"];
	        this.secretCleanupWarning = source["secretCleanupWarning"];
	    }
	}
	export class DeleteTerminalProfileRequest {
	    id: string;
	    forceDetachServers: boolean;

	    static createFrom(source: any = {}) {
	        return new DeleteTerminalProfileRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.forceDetachServers = source["forceDetachServers"];
	    }
	}
	export class DeleteTerminalProfileResponse {
	    id: string;
	    detachedServers: number;

	    static createFrom(source: any = {}) {
	        return new DeleteTerminalProfileResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.detachedServers = source["detachedServers"];
	    }
	}
	export class DiskMount {
	    filesystem: string;
	    mountPath: string;
	    total: number;
	    used: number;
	    available: number;
	    usedPercent: number;

	    static createFrom(source: any = {}) {
	        return new DiskMount(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filesystem = source["filesystem"];
	        this.mountPath = source["mountPath"];
	        this.total = source["total"];
	        this.used = source["used"];
	        this.available = source["available"];
	        this.usedPercent = source["usedPercent"];
	    }
	}
	export class DockerContainer {
	    id: string;
	    shortID: string;
	    name: string;
	    image: string;
	    command: string;
	    createdAt: string;
	    status: string;
	    state: string;
	    ports: string;
	    labels: string;
	    size: string;
	    serverID: number;

	    static createFrom(source: any = {}) {
	        return new DockerContainer(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.shortID = source["shortID"];
	        this.name = source["name"];
	        this.image = source["image"];
	        this.command = source["command"];
	        this.createdAt = source["createdAt"];
	        this.status = source["status"];
	        this.state = source["state"];
	        this.ports = source["ports"];
	        this.labels = source["labels"];
	        this.size = source["size"];
	        this.serverID = source["serverID"];
	    }
	}
	export class DockerAvailability {
	    serverID: number;
	    available: boolean;
	    version: string;
	    error: string;
	    lastRefreshAt: string;
	    containers: DockerContainer[];

	    static createFrom(source: any = {}) {
	        return new DockerAvailability(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.available = source["available"];
	        this.version = source["version"];
	        this.error = source["error"];
	        this.lastRefreshAt = source["lastRefreshAt"];
	        this.containers = this.convertValues(source["containers"], DockerContainer);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DockerBatchContainerRequest {
	    serverID: number;
	    containerIDs: string[];

	    static createFrom(source: any = {}) {
	        return new DockerBatchContainerRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.containerIDs = source["containerIDs"];
	    }
	}
	export class DockerBatchContainerResult {
	    containerID: string;
	    name: string;
	    action: string;
	    status: string;
	    success: boolean;
	    error: string;
	    reason: string;

	    static createFrom(source: any = {}) {
	        return new DockerBatchContainerResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.containerID = source["containerID"];
	        this.name = source["name"];
	        this.action = source["action"];
	        this.status = source["status"];
	        this.success = source["success"];
	        this.error = source["error"];
	        this.reason = source["reason"];
	    }
	}
	export class DockerBatchContainerResponse {
	    serverID: number;
	    results: DockerBatchContainerResult[];
	    successCount: number;
	    failedCount: number;
	    skippedCount: number;

	    static createFrom(source: any = {}) {
	        return new DockerBatchContainerResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.results = this.convertValues(source["results"], DockerBatchContainerResult);
	        this.successCount = source["successCount"];
	        this.failedCount = source["failedCount"];
	        this.skippedCount = source["skippedCount"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class DockerComposeCapability {
	    serverID: number;
	    available: boolean;
	    command: string;
	    version: string;
	    error: string;
	    lastRefreshAt: string;

	    static createFrom(source: any = {}) {
	        return new DockerComposeCapability(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.available = source["available"];
	        this.command = source["command"];
	        this.version = source["version"];
	        this.error = source["error"];
	        this.lastRefreshAt = source["lastRefreshAt"];
	    }
	}
	export class DockerComposeLogsRequest {
	    serverID: number;
	    projectName: string;
	    serviceName: string;
	    tailLines: number;

	    static createFrom(source: any = {}) {
	        return new DockerComposeLogsRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.projectName = source["projectName"];
	        this.serviceName = source["serviceName"];
	        this.tailLines = source["tailLines"];
	    }
	}
	export class DockerComposeLogsSnapshot {
	    serverID: number;
	    projectName: string;
	    serviceName: string;
	    output: string;
	    truncated: boolean;
	    timestamp: string;

	    static createFrom(source: any = {}) {
	        return new DockerComposeLogsSnapshot(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.projectName = source["projectName"];
	        this.serviceName = source["serviceName"];
	        this.output = source["output"];
	        this.truncated = source["truncated"];
	        this.timestamp = source["timestamp"];
	    }
	}
	export class DockerComposeProject {
	    serverID: number;
	    name: string;
	    status: string;
	    configFiles: string;
	    workingDir: string;

	    static createFrom(source: any = {}) {
	        return new DockerComposeProject(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.name = source["name"];
	        this.status = source["status"];
	        this.configFiles = source["configFiles"];
	        this.workingDir = source["workingDir"];
	    }
	}
	export class DockerComposeProjectRequest {
	    serverID: number;
	    projectName: string;

	    static createFrom(source: any = {}) {
	        return new DockerComposeProjectRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.projectName = source["projectName"];
	    }
	}
	export class DockerComposeProjectsRequest {
	    serverID: number;

	    static createFrom(source: any = {}) {
	        return new DockerComposeProjectsRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	    }
	}
	export class DockerComposeService {
	    serverID: number;
	    id: string;
	    name: string;
	    project: string;
	    service: string;
	    image: string;
	    command: string;
	    state: string;
	    status: string;
	    health: string;
	    ports: string;
	    exitCode: number;

	    static createFrom(source: any = {}) {
	        return new DockerComposeService(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.id = source["id"];
	        this.name = source["name"];
	        this.project = source["project"];
	        this.service = source["service"];
	        this.image = source["image"];
	        this.command = source["command"];
	        this.state = source["state"];
	        this.status = source["status"];
	        this.health = source["health"];
	        this.ports = source["ports"];
	        this.exitCode = source["exitCode"];
	    }
	}
	export class DockerComposeServiceDetailRequest {
	    serverID: number;
	    projectName: string;
	    serviceName: string;

	    static createFrom(source: any = {}) {
	        return new DockerComposeServiceDetailRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.projectName = source["projectName"];
	        this.serviceName = source["serviceName"];
	    }
	}
	export class DockerComposeServicesResponse {
	    serverID: number;
	    projectName: string;
	    services: DockerComposeService[];
	    timestamp: string;

	    static createFrom(source: any = {}) {
	        return new DockerComposeServicesResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.projectName = source["projectName"];
	        this.services = this.convertValues(source["services"], DockerComposeService);
	        this.timestamp = source["timestamp"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class DockerContainerRequest {
	    serverID: number;
	    containerID: string;

	    static createFrom(source: any = {}) {
	        return new DockerContainerRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.containerID = source["containerID"];
	    }
	}
	export class DockerContainerStats {
	    serverID: number;
	    containerID: string;
	    cpuPercent: number;
	    memoryUsage: number;
	    memoryLimit: number;
	    memoryPercent: number;
	    netInput: number;
	    netOutput: number;
	    blockInput: number;
	    blockOutput: number;
	    pids: number;
	    timestamp: string;

	    static createFrom(source: any = {}) {
	        return new DockerContainerStats(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.containerID = source["containerID"];
	        this.cpuPercent = source["cpuPercent"];
	        this.memoryUsage = source["memoryUsage"];
	        this.memoryLimit = source["memoryLimit"];
	        this.memoryPercent = source["memoryPercent"];
	        this.netInput = source["netInput"];
	        this.netOutput = source["netOutput"];
	        this.blockInput = source["blockInput"];
	        this.blockOutput = source["blockOutput"];
	        this.pids = source["pids"];
	        this.timestamp = source["timestamp"];
	    }
	}
	export class DockerInspectSummary {
	    serverID: number;
	    id: string;
	    name: string;
	    image: string;
	    created: string;
	    state: string;
	    status: string;
	    ports: string;
	    mountCount: number;
	    networkNames: string[];
	    restartPolicy: string;

	    static createFrom(source: any = {}) {
	        return new DockerInspectSummary(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.id = source["id"];
	        this.name = source["name"];
	        this.image = source["image"];
	        this.created = source["created"];
	        this.state = source["state"];
	        this.status = source["status"];
	        this.ports = source["ports"];
	        this.mountCount = source["mountCount"];
	        this.networkNames = source["networkNames"];
	        this.restartPolicy = source["restartPolicy"];
	    }
	}
	export class DockerListContainersRequest {
	    serverID: number;

	    static createFrom(source: any = {}) {
	        return new DockerListContainersRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	    }
	}
	export class DockerLogStreamRequest {
	    serverID: number;
	    containerID: string;
	    tailLines: number;
	    streamID: string;

	    static createFrom(source: any = {}) {
	        return new DockerLogStreamRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.containerID = source["containerID"];
	        this.tailLines = source["tailLines"];
	        this.streamID = source["streamID"];
	    }
	}
	export class DockerLogsRequest {
	    serverID: number;
	    containerID: string;
	    tailLines: number;

	    static createFrom(source: any = {}) {
	        return new DockerLogsRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.containerID = source["containerID"];
	        this.tailLines = source["tailLines"];
	    }
	}
	export class DockerStatsWatchRequest {
	    serverID: number;
	    containerID: string;
	    watchID: string;
	    intervalMs: number;

	    static createFrom(source: any = {}) {
	        return new DockerStatsWatchRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.containerID = source["containerID"];
	        this.watchID = source["watchID"];
	        this.intervalMs = source["intervalMs"];
	    }
	}
	export class DockerStopLogStreamRequest {
	    serverID: number;
	    streamID: string;

	    static createFrom(source: any = {}) {
	        return new DockerStopLogStreamRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.streamID = source["streamID"];
	    }
	}
	export class DockerStopStatsWatchRequest {
	    serverID: number;
	    watchID: string;

	    static createFrom(source: any = {}) {
	        return new DockerStopStatsWatchRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.watchID = source["watchID"];
	    }
	}
	export class GetProcessDetailRequest {
	    serverID: number;
	    pid: number;

	    static createFrom(source: any = {}) {
	        return new GetProcessDetailRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.pid = source["pid"];
	    }
	}
	export class Group {
	    id: number;
	    name: string;

	    static createFrom(source: any = {}) {
	        return new Group(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	    }
	}
	export class HostKeyProbeResult {
	    fingerprint: string;

	    static createFrom(source: any = {}) {
	        return new HostKeyProbeResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fingerprint = source["fingerprint"];
	    }
	}
	export class KeyVaultEntry {
	    id: number;
	    name: string;
	    privateKeyPath: string;
	    storageMode: string;
	    sourceFileName: string;
	    algorithm: string;
	    keyBits: number;
	    publicKeyFingerprintSHA256: string;
	    encrypted: boolean;
	    requiresPassphrase: boolean;
	    protectionVersion: number;
	    passphraseSaved: boolean;
	    usageCount: number;
	    notes: string;
	    createdAt: string;
	    updatedAt: string;
	    lastUsedAt: string;

	    static createFrom(source: any = {}) {
	        return new KeyVaultEntry(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.privateKeyPath = source["privateKeyPath"];
	        this.storageMode = source["storageMode"];
	        this.sourceFileName = source["sourceFileName"];
	        this.algorithm = source["algorithm"];
	        this.keyBits = source["keyBits"];
	        this.publicKeyFingerprintSHA256 = source["publicKeyFingerprintSHA256"];
	        this.encrypted = source["encrypted"];
	        this.requiresPassphrase = source["requiresPassphrase"];
	        this.protectionVersion = source["protectionVersion"];
	        this.passphraseSaved = source["passphraseSaved"];
	        this.usageCount = source["usageCount"];
	        this.notes = source["notes"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	        this.lastUsedAt = source["lastUsedAt"];
	    }
	}
	export class ListAlertHistoryRequest {
	    limit: number;

	    static createFrom(source: any = {}) {
	        return new ListAlertHistoryRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.limit = source["limit"];
	    }
	}
	export class ListCommandFavoritesRequest {
	    serverId: number;
	    groupId?: number;
	    scope: string;
	    query: string;

	    static createFrom(source: any = {}) {
	        return new ListCommandFavoritesRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverId = source["serverId"];
	        this.groupId = source["groupId"];
	        this.scope = source["scope"];
	        this.query = source["query"];
	    }
	}
	export class ListCommandHistoryRequest {
	    serverId: number;
	    scope: string;
	    query: string;
	    limit: number;

	    static createFrom(source: any = {}) {
	        return new ListCommandHistoryRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverId = source["serverId"];
	        this.scope = source["scope"];
	        this.query = source["query"];
	        this.limit = source["limit"];
	    }
	}
	export class ListCommandSuggestionsRequest {
	    serverId: number;
	    groupId?: number;
	    prefix: string;
	    limit: number;
	    includeHistory: boolean;
	    includeFavorites: boolean;
	    includeBuiltins: boolean;

	    static createFrom(source: any = {}) {
	        return new ListCommandSuggestionsRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverId = source["serverId"];
	        this.groupId = source["groupId"];
	        this.prefix = source["prefix"];
	        this.limit = source["limit"];
	        this.includeHistory = source["includeHistory"];
	        this.includeFavorites = source["includeFavorites"];
	        this.includeBuiltins = source["includeBuiltins"];
	    }
	}
	export class ListNetworkInterfacesRequest {
	    serverID: number;

	    static createFrom(source: any = {}) {
	        return new ListNetworkInterfacesRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	    }
	}
	export class NetworkInterface {
	    serverID: number;
	    name: string;
	    displayName: string;
	    isUp: boolean;
	    isLoopback: boolean;
	    ipv4: string[];
	    ipv6: string[];
	    mac?: string;
	    rxBytes: number;
	    txBytes: number;
	    rxPackets?: number;
	    txPackets?: number;
	    speedMbps?: number;
	    mtu?: number;
	    lastUpdatedAt: string;

	    static createFrom(source: any = {}) {
	        return new NetworkInterface(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.name = source["name"];
	        this.displayName = source["displayName"];
	        this.isUp = source["isUp"];
	        this.isLoopback = source["isLoopback"];
	        this.ipv4 = source["ipv4"];
	        this.ipv6 = source["ipv6"];
	        this.mac = source["mac"];
	        this.rxBytes = source["rxBytes"];
	        this.txBytes = source["txBytes"];
	        this.rxPackets = source["rxPackets"];
	        this.txPackets = source["txPackets"];
	        this.speedMbps = source["speedMbps"];
	        this.mtu = source["mtu"];
	        this.lastUpdatedAt = source["lastUpdatedAt"];
	    }
	}
	export class ListNetworkInterfacesResponse {
	    serverID: number;
	    interfaces: NetworkInterface[];
	    updatedAt: string;
	    recommendedInterface: string;
	    recommendedInterfaceReason: string;

	    static createFrom(source: any = {}) {
	        return new ListNetworkInterfacesResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.interfaces = this.convertValues(source["interfaces"], NetworkInterface);
	        this.updatedAt = source["updatedAt"];
	        this.recommendedInterface = source["recommendedInterface"];
	        this.recommendedInterfaceReason = source["recommendedInterfaceReason"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ListProcessesRequest {
	    serverID: number;
	    query?: string;
	    sortBy: string;
	    sortDir: string;
	    limit?: number;

	    static createFrom(source: any = {}) {
	        return new ListProcessesRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.query = source["query"];
	        this.sortBy = source["sortBy"];
	        this.sortDir = source["sortDir"];
	        this.limit = source["limit"];
	    }
	}
	export class ListTunnelsRequest {
	    serverID: number;

	    static createFrom(source: any = {}) {
	        return new ListTunnelsRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	    }
	}
	export class LocalFileEntry {
	    name: string;
	    path: string;
	    size: number;
	    isDir: boolean;
	    modTime: string;
	    displayType: string;

	    static createFrom(source: any = {}) {
	        return new LocalFileEntry(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.isDir = source["isDir"];
	        this.modTime = source["modTime"];
	        this.displayType = source["displayType"];
	    }
	}
	export class LocalDirectoryListing {
	    path: string;
	    parent: string;
	    entries: LocalFileEntry[];

	    static createFrom(source: any = {}) {
	        return new LocalDirectoryListing(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.parent = source["parent"];
	        this.entries = this.convertValues(source["entries"], LocalFileEntry);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LocalDirectoryRequest {
	    path: string;

	    static createFrom(source: any = {}) {
	        return new LocalDirectoryRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	    }
	}
	export class LocalDiskVolume {
	    name: string;
	    mountPath: string;
	    total: number;
	    used: number;
	    available: number;
	    usedPercent: number;

	    static createFrom(source: any = {}) {
	        return new LocalDiskVolume(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.mountPath = source["mountPath"];
	        this.total = source["total"];
	        this.used = source["used"];
	        this.available = source["available"];
	        this.usedPercent = source["usedPercent"];
	    }
	}
	export class LocalDrive {
	    name: string;
	    path: string;

	    static createFrom(source: any = {}) {
	        return new LocalDrive(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	    }
	}
	export class LocalExplorerHome {
	    path: string;

	    static createFrom(source: any = {}) {
	        return new LocalExplorerHome(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	    }
	}

	export class LocalGpuSnapshot {
	    name: string;
	    available: boolean;
	    usagePercent: number;
	    memoryUsedBytes: number;
	    memoryTotalBytes: number;
	    unavailableReason: string;

	    static createFrom(source: any = {}) {
	        return new LocalGpuSnapshot(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.available = source["available"];
	        this.usagePercent = source["usagePercent"];
	        this.memoryUsedBytes = source["memoryUsedBytes"];
	        this.memoryTotalBytes = source["memoryTotalBytes"];
	        this.unavailableReason = source["unavailableReason"];
	    }
	}
	export class LocalNetworkInterface {
	    name: string;
	    displayName: string;
	    description: string;
	    isUp: boolean;
	    hasGateway: boolean;
	    isDefaultRoute: boolean;
	    isPhysicalLike: boolean;
	    isVirtual: boolean;
	    isLoopback: boolean;
	    isHiddenByDefault: boolean;
	    speedBps: number;
	    rxBytes: number;
	    txBytes: number;
	    uploadBytesPerSecond: number;
	    downloadBytesPerSecond: number;

	    static createFrom(source: any = {}) {
	        return new LocalNetworkInterface(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.displayName = source["displayName"];
	        this.description = source["description"];
	        this.isUp = source["isUp"];
	        this.hasGateway = source["hasGateway"];
	        this.isDefaultRoute = source["isDefaultRoute"];
	        this.isPhysicalLike = source["isPhysicalLike"];
	        this.isVirtual = source["isVirtual"];
	        this.isLoopback = source["isLoopback"];
	        this.isHiddenByDefault = source["isHiddenByDefault"];
	        this.speedBps = source["speedBps"];
	        this.rxBytes = source["rxBytes"];
	        this.txBytes = source["txBytes"];
	        this.uploadBytesPerSecond = source["uploadBytesPerSecond"];
	        this.downloadBytesPerSecond = source["downloadBytesPerSecond"];
	    }
	}
	export class LocalPathRequest {
	    path: string;

	    static createFrom(source: any = {}) {
	        return new LocalPathRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	    }
	}
	export class LocalProcessInfo {
	    pid: number;
	    name: string;
	    cpuPercent: number;
	    memoryBytes: number;
	    memoryPercent: number;

	    static createFrom(source: any = {}) {
	        return new LocalProcessInfo(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pid = source["pid"];
	        this.name = source["name"];
	        this.cpuPercent = source["cpuPercent"];
	        this.memoryBytes = source["memoryBytes"];
	        this.memoryPercent = source["memoryPercent"];
	    }
	}
	export class LocalResourceSnapshot {
	    status: string;
	    hostname: string;
	    platform: string;
	    osName: string;
	    osVersion: string;
	    osBuild: string;
	    architecture: string;
	    cpuModel: string;
	    cpuCores: number;
	    cpuLogicalProcessors: number;
	    timestamp: string;
	    uptimeSeconds: number;
	    cpuPercent: number;
	    memoryTotal: number;
	    memoryAvailable: number;
	    memoryUsedPercent: number;
	    swapTotal: number;
	    swapFree: number;
	    pagefileTotal: number;
	    pagefileFree: number;
	    gpus: LocalGpuSnapshot[];
	    uploadBytesPerSecond: number;
	    downloadBytesPerSecond: number;
	    networkInterfaces: LocalNetworkInterface[];
	    disks: LocalDiskVolume[];
	    processes: LocalProcessInfo[];

	    static createFrom(source: any = {}) {
	        return new LocalResourceSnapshot(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.hostname = source["hostname"];
	        this.platform = source["platform"];
	        this.osName = source["osName"];
	        this.osVersion = source["osVersion"];
	        this.osBuild = source["osBuild"];
	        this.architecture = source["architecture"];
	        this.cpuModel = source["cpuModel"];
	        this.cpuCores = source["cpuCores"];
	        this.cpuLogicalProcessors = source["cpuLogicalProcessors"];
	        this.timestamp = source["timestamp"];
	        this.uptimeSeconds = source["uptimeSeconds"];
	        this.cpuPercent = source["cpuPercent"];
	        this.memoryTotal = source["memoryTotal"];
	        this.memoryAvailable = source["memoryAvailable"];
	        this.memoryUsedPercent = source["memoryUsedPercent"];
	        this.swapTotal = source["swapTotal"];
	        this.swapFree = source["swapFree"];
	        this.pagefileTotal = source["pagefileTotal"];
	        this.pagefileFree = source["pagefileFree"];
	        this.gpus = this.convertValues(source["gpus"], LocalGpuSnapshot);
	        this.uploadBytesPerSecond = source["uploadBytesPerSecond"];
	        this.downloadBytesPerSecond = source["downloadBytesPerSecond"];
	        this.networkInterfaces = this.convertValues(source["networkInterfaces"], LocalNetworkInterface);
	        this.disks = this.convertValues(source["disks"], LocalDiskVolume);
	        this.processes = this.convertValues(source["processes"], LocalProcessInfo);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LocalTerminalShellOption {
	    id: string;
	    label: string;
	    description: string;

	    static createFrom(source: any = {}) {
	        return new LocalTerminalShellOption(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.description = source["description"];
	    }
	}
	export class LocalTerminalCapabilities {
	    platform: string;
	    enabled: boolean;
	    supported: boolean;
	    conptyAvailable: boolean;
	    isProcessElevated: boolean;
	    supportsElevation: boolean;
	    shellOptions: LocalTerminalShellOption[];
	    adminShellOptions: LocalTerminalShellOption[];
	    defaultShellPreference: string;
	    currentShellPreference: string;
	    unsupportedMessage: string;

	    static createFrom(source: any = {}) {
	        return new LocalTerminalCapabilities(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.platform = source["platform"];
	        this.enabled = source["enabled"];
	        this.supported = source["supported"];
	        this.conptyAvailable = source["conptyAvailable"];
	        this.isProcessElevated = source["isProcessElevated"];
	        this.supportsElevation = source["supportsElevation"];
	        this.shellOptions = this.convertValues(source["shellOptions"], LocalTerminalShellOption);
	        this.adminShellOptions = this.convertValues(source["adminShellOptions"], LocalTerminalShellOption);
	        this.defaultShellPreference = source["defaultShellPreference"];
	        this.currentShellPreference = source["currentShellPreference"];
	        this.unsupportedMessage = source["unsupportedMessage"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LocalTerminalElevatedRelaunchRequest {
	    shellKind: string;

	    static createFrom(source: any = {}) {
	        return new LocalTerminalElevatedRelaunchRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.shellKind = source["shellKind"];
	    }
	}
	export class LocalTerminalOpenRequest {
	    shellKind: string;
	    elevated: boolean;
	    shell: string;
	    cwd: string;
	    rows: number;
	    cols: number;

	    static createFrom(source: any = {}) {
	        return new LocalTerminalOpenRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.shellKind = source["shellKind"];
	        this.elevated = source["elevated"];
	        this.shell = source["shell"];
	        this.cwd = source["cwd"];
	        this.rows = source["rows"];
	        this.cols = source["cols"];
	    }
	}
	export class LocalTerminalOpenResponse {
	    sessionId: string;
	    shellKind: string;
	    shell: string;
	    shellName: string;
	    elevated: boolean;
	    title: string;
	    status: string;
	    cwd: string;
	    startedAt: string;

	    static createFrom(source: any = {}) {
	        return new LocalTerminalOpenResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.shellKind = source["shellKind"];
	        this.shell = source["shell"];
	        this.shellName = source["shellName"];
	        this.elevated = source["elevated"];
	        this.title = source["title"];
	        this.status = source["status"];
	        this.cwd = source["cwd"];
	        this.startedAt = source["startedAt"];
	    }
	}
	export class LocalTerminalResizeRequest {
	    sessionId: string;
	    rows: number;
	    cols: number;

	    static createFrom(source: any = {}) {
	        return new LocalTerminalResizeRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.rows = source["rows"];
	        this.cols = source["cols"];
	    }
	}

	export class LocalTerminalStartupRequest {
	    shellKind: string;

	    static createFrom(source: any = {}) {
	        return new LocalTerminalStartupRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.shellKind = source["shellKind"];
	    }
	}
	export class LocalTerminalState {
	    sessionId: string;
	    shellKind: string;
	    shell: string;
	    shellName: string;
	    elevated: boolean;
	    title: string;
	    cwd: string;
	    status: string;
	    exitCode?: number;
	    error: string;
	    startedAt: string;
	    endedAt: string;

	    static createFrom(source: any = {}) {
	        return new LocalTerminalState(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.shellKind = source["shellKind"];
	        this.shell = source["shell"];
	        this.shellName = source["shellName"];
	        this.elevated = source["elevated"];
	        this.title = source["title"];
	        this.cwd = source["cwd"];
	        this.status = source["status"];
	        this.exitCode = source["exitCode"];
	        this.error = source["error"];
	        this.startedAt = source["startedAt"];
	        this.endedAt = source["endedAt"];
	    }
	}
	export class LocalTerminalWriteRequest {
	    sessionId: string;
	    dataBase64: string;

	    static createFrom(source: any = {}) {
	        return new LocalTerminalWriteRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.dataBase64 = source["dataBase64"];
	    }
	}
	export class LogEntry {
	    time: string;
	    level: string;
	    message: string;
	    summary: string;
	    serverName?: string;
	    connectionId?: number;
	    operation?: string;
	    error?: string;
	    technicalMessage?: string;
	    errorCode?: string;

	    static createFrom(source: any = {}) {
	        return new LogEntry(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = source["time"];
	        this.level = source["level"];
	        this.message = source["message"];
	        this.summary = source["summary"];
	        this.serverName = source["serverName"];
	        this.connectionId = source["connectionId"];
	        this.operation = source["operation"];
	        this.error = source["error"];
	        this.technicalMessage = source["technicalMessage"];
	        this.errorCode = source["errorCode"];
	    }
	}
	export class MarkAlertHistoryReadRequest {
	    eventID: string;

	    static createFrom(source: any = {}) {
	        return new MarkAlertHistoryReadRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.eventID = source["eventID"];
	    }
	}
	export class MarkAllAlertHistoryReadRequest {


	    static createFrom(source: any = {}) {
	        return new MarkAllAlertHistoryReadRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);

	    }
	}
	export class MetricError {
	    metric: string;
	    message: string;

	    static createFrom(source: any = {}) {
	        return new MetricError(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.metric = source["metric"];
	        this.message = source["message"];
	    }
	}
	export class MonitorNetworkInterfacePreference {
	    serverID: number;
	    mode: string;
	    selectedNetworkInterface: string;
	    userSelected: boolean;
	    updatedAt: string;

	    static createFrom(source: any = {}) {
	        return new MonitorNetworkInterfacePreference(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.mode = source["mode"];
	        this.selectedNetworkInterface = source["selectedNetworkInterface"];
	        this.userSelected = source["userSelected"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class ProcessInfo {
	    pid: number;
	    cpuPercent: number;
	    memoryPercent: number;
	    command: string;

	    static createFrom(source: any = {}) {
	        return new ProcessInfo(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pid = source["pid"];
	        this.cpuPercent = source["cpuPercent"];
	        this.memoryPercent = source["memoryPercent"];
	        this.command = source["command"];
	    }
	}
	export class MonitorSnapshot {
	    connectionId: number;
	    status: string;
	    timestamp: string;
	    latencyMillis: number;
	    latencyAvailable: boolean;
	    cpuPercent?: number;
	    memoryTotal: number;
	    memoryAvailable: number;
	    memoryUsedPercent?: number;
	    swapTotal: number;
	    swapFree: number;
	    diskTotal: number;
	    diskUsed: number;
	    diskUsedPercent?: number;
	    mounts: DiskMount[];
	    processes: ProcessInfo[];
	    processStatus: string;
	    processMessage: string;
	    loadOne?: number;
	    loadFive?: number;
	    loadFifteen?: number;
	    uptimeSeconds?: number;
	    defaultInterface: string;
	    networkInterfaceMode: string;
	    selectedNetworkInterface: string;
	    effectiveNetworkInterface: string;
	    networkInterfaceFallback: boolean;
	    networkInterfaceMessage: string;
	    downloadBytesPerSecond?: number;
	    uploadBytesPerSecond?: number;
	    osName: string;
	    kernel: string;
	    architecture: string;
	    errors: MetricError[];
	    errorCode: string;
	    message: string;
	    monitorActive: boolean;
	    connectionError?: ConnectionError;

	    static createFrom(source: any = {}) {
	        return new MonitorSnapshot(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.status = source["status"];
	        this.timestamp = source["timestamp"];
	        this.latencyMillis = source["latencyMillis"];
	        this.latencyAvailable = source["latencyAvailable"];
	        this.cpuPercent = source["cpuPercent"];
	        this.memoryTotal = source["memoryTotal"];
	        this.memoryAvailable = source["memoryAvailable"];
	        this.memoryUsedPercent = source["memoryUsedPercent"];
	        this.swapTotal = source["swapTotal"];
	        this.swapFree = source["swapFree"];
	        this.diskTotal = source["diskTotal"];
	        this.diskUsed = source["diskUsed"];
	        this.diskUsedPercent = source["diskUsedPercent"];
	        this.mounts = this.convertValues(source["mounts"], DiskMount);
	        this.processes = this.convertValues(source["processes"], ProcessInfo);
	        this.processStatus = source["processStatus"];
	        this.processMessage = source["processMessage"];
	        this.loadOne = source["loadOne"];
	        this.loadFive = source["loadFive"];
	        this.loadFifteen = source["loadFifteen"];
	        this.uptimeSeconds = source["uptimeSeconds"];
	        this.defaultInterface = source["defaultInterface"];
	        this.networkInterfaceMode = source["networkInterfaceMode"];
	        this.selectedNetworkInterface = source["selectedNetworkInterface"];
	        this.effectiveNetworkInterface = source["effectiveNetworkInterface"];
	        this.networkInterfaceFallback = source["networkInterfaceFallback"];
	        this.networkInterfaceMessage = source["networkInterfaceMessage"];
	        this.downloadBytesPerSecond = source["downloadBytesPerSecond"];
	        this.uploadBytesPerSecond = source["uploadBytesPerSecond"];
	        this.osName = source["osName"];
	        this.kernel = source["kernel"];
	        this.architecture = source["architecture"];
	        this.errors = this.convertValues(source["errors"], MetricError);
	        this.errorCode = source["errorCode"];
	        this.message = source["message"];
	        this.monitorActive = source["monitorActive"];
	        this.connectionError = this.convertValues(source["connectionError"], ConnectionError);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class NetworkDiagnosticTask {
	    taskID: string;
	    serverID: number;
	    type: string;
	    target: string;
	    port?: number;
	    status: string;
	    startedAt: string;
	    endedAt?: string;
	    error?: string;

	    static createFrom(source: any = {}) {
	        return new NetworkDiagnosticTask(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.taskID = source["taskID"];
	        this.serverID = source["serverID"];
	        this.type = source["type"];
	        this.target = source["target"];
	        this.port = source["port"];
	        this.status = source["status"];
	        this.startedAt = source["startedAt"];
	        this.endedAt = source["endedAt"];
	        this.error = source["error"];
	    }
	}
	export class NetworkEndpointSummary {
	    rowID: string;
	    serverID: number;
	    protocol: string;
	    family: string;
	    listenAddress: string;
	    listenPort: number;
	    pid?: number;
	    pidLabel: string;
	    processName: string;
	    sourceType: string;
	    sourceName: string;
	    containerID?: string;
	    containerName?: string;
	    uniqueRemoteIPCount?: number;
	    connectionCount?: number;
	    uploadedBytes?: number;
	    uploadedBytesEstimate?: number;
	    uploadedBytesEstimated: boolean;
	    downloadedBytes?: number;
	    aggregatedProcessCount?: number;
	    connectionDataAvailable: boolean;
	    byteCountersAvailable: boolean;
	    byteCountersPartial: boolean;
	    permissionLimited: boolean;
	    aggregationApproximate: boolean;
	    hasListener: boolean;
	    hasActiveConnections: boolean;
	    rowKind: string;
	    state: string;
	    lastUpdatedAt: string;

	    static createFrom(source: any = {}) {
	        return new NetworkEndpointSummary(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rowID = source["rowID"];
	        this.serverID = source["serverID"];
	        this.protocol = source["protocol"];
	        this.family = source["family"];
	        this.listenAddress = source["listenAddress"];
	        this.listenPort = source["listenPort"];
	        this.pid = source["pid"];
	        this.pidLabel = source["pidLabel"];
	        this.processName = source["processName"];
	        this.sourceType = source["sourceType"];
	        this.sourceName = source["sourceName"];
	        this.containerID = source["containerID"];
	        this.containerName = source["containerName"];
	        this.uniqueRemoteIPCount = source["uniqueRemoteIPCount"];
	        this.connectionCount = source["connectionCount"];
	        this.uploadedBytes = source["uploadedBytes"];
	        this.uploadedBytesEstimate = source["uploadedBytesEstimate"];
	        this.uploadedBytesEstimated = source["uploadedBytesEstimated"];
	        this.downloadedBytes = source["downloadedBytes"];
	        this.aggregatedProcessCount = source["aggregatedProcessCount"];
	        this.connectionDataAvailable = source["connectionDataAvailable"];
	        this.byteCountersAvailable = source["byteCountersAvailable"];
	        this.byteCountersPartial = source["byteCountersPartial"];
	        this.permissionLimited = source["permissionLimited"];
	        this.aggregationApproximate = source["aggregationApproximate"];
	        this.hasListener = source["hasListener"];
	        this.hasActiveConnections = source["hasActiveConnections"];
	        this.rowKind = source["rowKind"];
	        this.state = source["state"];
	        this.lastUpdatedAt = source["lastUpdatedAt"];
	    }
	}
	export class NetworkEndpointSnapshot {
	    serverID: number;
	    contextID: string;
	    strategy: string;
	    listenersAvailable: boolean;
	    connectionsAvailable: boolean;
	    processInfoAvailable: boolean;
	    permissionLimited: boolean;
	    byteCountersAvailable: boolean;
	    byteCountersPartial: boolean;
	    listeners: NetworkEndpointSummary[];
	    totalListeners: number;
	    totalConnections?: number;
	    uniqueRemoteIPs?: number;
	    socketConnectionCount?: number;
	    socketRemoteIPCount?: number;
	    hostSocketConnectionCount?: number;
	    hostRemoteIPCount?: number;
	    dockerSocketConnectionCount?: number;
	    dockerRemoteIPCount?: number;
	    totalSocketConnectionCount?: number;
	    totalRemoteIPCount?: number;
	    conntrackConnectionCount?: number;
	    conntrackRemoteIPCount?: number;
	    conntrackAvailable: boolean;
	    conntrackSource: string;
	    listenerCount: number;
	    dockerAvailable: boolean;
	    dockerNamespaceAvailable: boolean;
	    dockerPermissionLimited: boolean;
	    dockerContainerCount: number;
	    dockerScannedContainerCount: number;
	    dockerAggregated: boolean;
	    dockerTruncated: boolean;
	    interfaceScope: string;
	    aggregated: boolean;
	    rawConnectionCountBeforeLimit?: number;
	    returnedRowCount: number;
	    rowLimit: number;
	    socketUploadBytesKnownCount: number;
	    socketUploadBytesEstimatedCount: number;
	    socketDownloadBytesKnownCount: number;
	    socketCounterMissingCount: number;
	    collectedAt: string;
	    warnings: string[];

	    static createFrom(source: any = {}) {
	        return new NetworkEndpointSnapshot(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.contextID = source["contextID"];
	        this.strategy = source["strategy"];
	        this.listenersAvailable = source["listenersAvailable"];
	        this.connectionsAvailable = source["connectionsAvailable"];
	        this.processInfoAvailable = source["processInfoAvailable"];
	        this.permissionLimited = source["permissionLimited"];
	        this.byteCountersAvailable = source["byteCountersAvailable"];
	        this.byteCountersPartial = source["byteCountersPartial"];
	        this.listeners = this.convertValues(source["listeners"], NetworkEndpointSummary);
	        this.totalListeners = source["totalListeners"];
	        this.totalConnections = source["totalConnections"];
	        this.uniqueRemoteIPs = source["uniqueRemoteIPs"];
	        this.socketConnectionCount = source["socketConnectionCount"];
	        this.socketRemoteIPCount = source["socketRemoteIPCount"];
	        this.hostSocketConnectionCount = source["hostSocketConnectionCount"];
	        this.hostRemoteIPCount = source["hostRemoteIPCount"];
	        this.dockerSocketConnectionCount = source["dockerSocketConnectionCount"];
	        this.dockerRemoteIPCount = source["dockerRemoteIPCount"];
	        this.totalSocketConnectionCount = source["totalSocketConnectionCount"];
	        this.totalRemoteIPCount = source["totalRemoteIPCount"];
	        this.conntrackConnectionCount = source["conntrackConnectionCount"];
	        this.conntrackRemoteIPCount = source["conntrackRemoteIPCount"];
	        this.conntrackAvailable = source["conntrackAvailable"];
	        this.conntrackSource = source["conntrackSource"];
	        this.listenerCount = source["listenerCount"];
	        this.dockerAvailable = source["dockerAvailable"];
	        this.dockerNamespaceAvailable = source["dockerNamespaceAvailable"];
	        this.dockerPermissionLimited = source["dockerPermissionLimited"];
	        this.dockerContainerCount = source["dockerContainerCount"];
	        this.dockerScannedContainerCount = source["dockerScannedContainerCount"];
	        this.dockerAggregated = source["dockerAggregated"];
	        this.dockerTruncated = source["dockerTruncated"];
	        this.interfaceScope = source["interfaceScope"];
	        this.aggregated = source["aggregated"];
	        this.rawConnectionCountBeforeLimit = source["rawConnectionCountBeforeLimit"];
	        this.returnedRowCount = source["returnedRowCount"];
	        this.rowLimit = source["rowLimit"];
	        this.socketUploadBytesKnownCount = source["socketUploadBytesKnownCount"];
	        this.socketUploadBytesEstimatedCount = source["socketUploadBytesEstimatedCount"];
	        this.socketDownloadBytesKnownCount = source["socketDownloadBytesKnownCount"];
	        this.socketCounterMissingCount = source["socketCounterMissingCount"];
	        this.collectedAt = source["collectedAt"];
	        this.warnings = source["warnings"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class NetworkEndpointSnapshotRequest {
	    serverID: number;
	    contextID: string;
	    interfaceName?: string;
	    scope?: string;

	    static createFrom(source: any = {}) {
	        return new NetworkEndpointSnapshotRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.contextID = source["contextID"];
	        this.interfaceName = source["interfaceName"];
	        this.scope = source["scope"];
	    }
	}



	export class OpenNetworkInspectionContextRequest {
	    serverID: number;

	    static createFrom(source: any = {}) {
	        return new OpenNetworkInspectionContextRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	    }
	}
	export class OpenNetworkInspectionContextResponse {
	    serverID: number;
	    contextID: string;
	    openedAt: string;

	    static createFrom(source: any = {}) {
	        return new OpenNetworkInspectionContextResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.contextID = source["contextID"];
	        this.openedAt = source["openedAt"];
	    }
	}
	export class OpenTerminalRequest {
	    connectionId: number;
	    auth: AuthRequest;
	    columns: number;
	    rows: number;

	    static createFrom(source: any = {}) {
	        return new OpenTerminalRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.auth = this.convertValues(source["auth"], AuthRequest);
	        this.columns = source["columns"];
	        this.rows = source["rows"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PersistAlertHistoryEventRequest {
	    event: AlertHistoryEvent;
	    historyLimit: number;

	    static createFrom(source: any = {}) {
	        return new PersistAlertHistoryEventRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.event = this.convertValues(source["event"], AlertHistoryEvent);
	        this.historyLimit = source["historyLimit"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PrivateKeyValidationResult {
	    algorithm: string;
	    fingerprintSHA256: string;
	    keyBits: number;
	    encrypted: boolean;
	    valid: boolean;
	    errorCode: string;
	    userMessage: string;
	    technicalMessage: string;

	    static createFrom(source: any = {}) {
	        return new PrivateKeyValidationResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.algorithm = source["algorithm"];
	        this.fingerprintSHA256 = source["fingerprintSHA256"];
	        this.keyBits = source["keyBits"];
	        this.encrypted = source["encrypted"];
	        this.valid = source["valid"];
	        this.errorCode = source["errorCode"];
	        this.userMessage = source["userMessage"];
	        this.technicalMessage = source["technicalMessage"];
	    }
	}
	export class ProcessEntry {
	    serverID: number;
	    pid: number;
	    ppid: number;
	    user: string;
	    state: string;
	    stateLabel: string;
	    cpuPercent: number;
	    memoryPercent: number;
	    rssBytes: number;
	    vszBytes: number;
	    command: string;
	    argsPreview: string;
	    startedOrElapsed: string;
	    isKernelThread: boolean;
	    canSignal: boolean;

	    static createFrom(source: any = {}) {
	        return new ProcessEntry(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.pid = source["pid"];
	        this.ppid = source["ppid"];
	        this.user = source["user"];
	        this.state = source["state"];
	        this.stateLabel = source["stateLabel"];
	        this.cpuPercent = source["cpuPercent"];
	        this.memoryPercent = source["memoryPercent"];
	        this.rssBytes = source["rssBytes"];
	        this.vszBytes = source["vszBytes"];
	        this.command = source["command"];
	        this.argsPreview = source["argsPreview"];
	        this.startedOrElapsed = source["startedOrElapsed"];
	        this.isKernelThread = source["isKernelThread"];
	        this.canSignal = source["canSignal"];
	    }
	}
	export class ProcessDetail {
	    serverID: number;
	    pid: number;
	    ppid: number;
	    user: string;
	    state: string;
	    stateLabel: string;
	    command: string;
	    cmdline: string;
	    cwd?: string;
	    exe?: string;
	    openFilesCount?: number;
	    threads?: number;
	    rssBytes: number;
	    vszBytes: number;
	    memoryPercent: number;
	    cpuPercent: number;
	    environmentRedacted: boolean;
	    children: ProcessEntry[];
	    parent?: ProcessEntry;
	    lastUpdatedAt: string;
	    warnings: string[];
	    isKernelThread: boolean;
	    canSignal: boolean;

	    static createFrom(source: any = {}) {
	        return new ProcessDetail(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.pid = source["pid"];
	        this.ppid = source["ppid"];
	        this.user = source["user"];
	        this.state = source["state"];
	        this.stateLabel = source["stateLabel"];
	        this.command = source["command"];
	        this.cmdline = source["cmdline"];
	        this.cwd = source["cwd"];
	        this.exe = source["exe"];
	        this.openFilesCount = source["openFilesCount"];
	        this.threads = source["threads"];
	        this.rssBytes = source["rssBytes"];
	        this.vszBytes = source["vszBytes"];
	        this.memoryPercent = source["memoryPercent"];
	        this.cpuPercent = source["cpuPercent"];
	        this.environmentRedacted = source["environmentRedacted"];
	        this.children = this.convertValues(source["children"], ProcessEntry);
	        this.parent = this.convertValues(source["parent"], ProcessEntry);
	        this.lastUpdatedAt = source["lastUpdatedAt"];
	        this.warnings = source["warnings"];
	        this.isKernelThread = source["isKernelThread"];
	        this.canSignal = source["canSignal"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}


	export class ProcessListResponse {
	    serverID: number;
	    processes: ProcessEntry[];
	    warnings: string[];
	    parserStrategy?: string;
	    timestamp: string;

	    static createFrom(source: any = {}) {
	        return new ProcessListResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.processes = this.convertValues(source["processes"], ProcessEntry);
	        this.warnings = source["warnings"];
	        this.parserStrategy = source["parserStrategy"];
	        this.timestamp = source["timestamp"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ReconnectTerminalRequest {
	    sessionId: string;
	    connectionId: number;
	    auth: AuthRequest;
	    columns: number;
	    rows: number;

	    static createFrom(source: any = {}) {
	        return new ReconnectTerminalRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.connectionId = source["connectionId"];
	        this.auth = this.convertValues(source["auth"], AuthRequest);
	        this.columns = source["columns"];
	        this.rows = source["rows"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RecordBatchCommandHistoryRequest {
	    command: string;
	    successfulServerIds: number[];
	    submissionId: string;

	    static createFrom(source: any = {}) {
	        return new RecordBatchCommandHistoryRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.command = source["command"];
	        this.successfulServerIds = source["successfulServerIds"];
	        this.submissionId = source["submissionId"];
	    }
	}
	export class RecordBatchCommandHistoryResult {
	    recorded: boolean;
	    skipped: boolean;
	    reasonCode: string;
	    message: string;
	    historyId: string;
	    targetCount: number;
	    entry?: CommandHistoryEntry;

	    static createFrom(source: any = {}) {
	        return new RecordBatchCommandHistoryResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.recorded = source["recorded"];
	        this.skipped = source["skipped"];
	        this.reasonCode = source["reasonCode"];
	        this.message = source["message"];
	        this.historyId = source["historyId"];
	        this.targetCount = source["targetCount"];
	        this.entry = this.convertValues(source["entry"], CommandHistoryEntry);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RecordCommandHistoryRequest {
	    serverId: number;
	    sessionId: string;
	    command: string;
	    source: string;

	    static createFrom(source: any = {}) {
	        return new RecordCommandHistoryRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverId = source["serverId"];
	        this.sessionId = source["sessionId"];
	        this.command = source["command"];
	        this.source = source["source"];
	    }
	}
	export class RecordCommandHistoryResult {
	    recorded: boolean;
	    skipped: boolean;
	    reasonCode: string;
	    message: string;
	    entry?: CommandHistoryEntry;

	    static createFrom(source: any = {}) {
	        return new RecordCommandHistoryResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.recorded = source["recorded"];
	        this.skipped = source["skipped"];
	        this.reasonCode = source["reasonCode"];
	        this.message = source["message"];
	        this.entry = this.convertValues(source["entry"], CommandHistoryEntry);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RemoteForwardAccessEnableResult {
	    success: boolean;
	    backupPath: string;
	    changedFiles: string[];
	    reloadCommand: string;
	    message: string;
	    warnings: string[];

	    static createFrom(source: any = {}) {
	        return new RemoteForwardAccessEnableResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.backupPath = source["backupPath"];
	        this.changedFiles = source["changedFiles"];
	        this.reloadCommand = source["reloadCommand"];
	        this.message = source["message"];
	        this.warnings = source["warnings"];
	    }
	}
	export class RemoteForwardAccessInspectResult {
	    serverID: number;
	    sshdType: string;
	    configPath: string;
	    gatewayPortsEffective: string;
	    allowTcpForwardingEffective: string;
	    canModify: boolean;
	    requiresSudo: boolean;
	    warnings: string[];

	    static createFrom(source: any = {}) {
	        return new RemoteForwardAccessInspectResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.sshdType = source["sshdType"];
	        this.configPath = source["configPath"];
	        this.gatewayPortsEffective = source["gatewayPortsEffective"];
	        this.allowTcpForwardingEffective = source["allowTcpForwardingEffective"];
	        this.canModify = source["canModify"];
	        this.requiresSudo = source["requiresSudo"];
	        this.warnings = source["warnings"];
	    }
	}
	export class RemoteForwardAccessRequest {
	    serverID: number;
	    tunnelID: string;
	    remoteBindHost: string;
	    remoteBindPort: number;

	    static createFrom(source: any = {}) {
	        return new RemoteForwardAccessRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.tunnelID = source["tunnelID"];
	        this.remoteBindHost = source["remoteBindHost"];
	        this.remoteBindPort = source["remoteBindPort"];
	    }
	}
	export class RemoteForwardAccessRestartRequest {
	    serverID: number;
	    tunnelID: string;
	    profileID: number;
	    auth: AuthRequest;

	    static createFrom(source: any = {}) {
	        return new RemoteForwardAccessRestartRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.tunnelID = source["tunnelID"];
	        this.profileID = source["profileID"];
	        this.auth = this.convertValues(source["auth"], AuthRequest);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TunnelRuntime {
	    tunnelID: string;
	    serverID: number;
	    profileID: number;
	    name: string;
	    type: string;
	    status: string;
	    bindHost: string;
	    bindPort: number;
	    targetHost: string;
	    targetPort: number;
	    remoteBindHost: string;
	    remoteBindPort: number;
	    requestedListen: string;
	    actualListen: string;
	    effectiveRemoteBindHost: string;
	    effectiveListenAddrs: string[];
	    remoteListenExposure: string;
	    remoteListenCheckStatus: string;
	    remoteListenWarning: string;
	    testCommand: string;
	    activeConnections: number;
	    bytesIn: number;
	    bytesOut: number;
	    startedAt: string;
	    updatedAt: string;
	    error: string;

	    static createFrom(source: any = {}) {
	        return new TunnelRuntime(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tunnelID = source["tunnelID"];
	        this.serverID = source["serverID"];
	        this.profileID = source["profileID"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.status = source["status"];
	        this.bindHost = source["bindHost"];
	        this.bindPort = source["bindPort"];
	        this.targetHost = source["targetHost"];
	        this.targetPort = source["targetPort"];
	        this.remoteBindHost = source["remoteBindHost"];
	        this.remoteBindPort = source["remoteBindPort"];
	        this.requestedListen = source["requestedListen"];
	        this.actualListen = source["actualListen"];
	        this.effectiveRemoteBindHost = source["effectiveRemoteBindHost"];
	        this.effectiveListenAddrs = source["effectiveListenAddrs"];
	        this.remoteListenExposure = source["remoteListenExposure"];
	        this.remoteListenCheckStatus = source["remoteListenCheckStatus"];
	        this.remoteListenWarning = source["remoteListenWarning"];
	        this.testCommand = source["testCommand"];
	        this.activeConnections = source["activeConnections"];
	        this.bytesIn = source["bytesIn"];
	        this.bytesOut = source["bytesOut"];
	        this.startedAt = source["startedAt"];
	        this.updatedAt = source["updatedAt"];
	        this.error = source["error"];
	    }
	}
	export class RemoteForwardAccessRestartResult {
	    access: RemoteForwardAccessEnableResult;
	    runtime: TunnelRuntime;

	    static createFrom(source: any = {}) {
	        return new RemoteForwardAccessRestartResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.access = this.convertValues(source["access"], RemoteForwardAccessEnableResult);
	        this.runtime = this.convertValues(source["runtime"], TunnelRuntime);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ReorderServersRequest {
	    serverID: number;
	    sourceGroupID?: number;
	    targetGroupID?: number;
	    beforeServerID?: number;
	    afterServerID?: number;

	    static createFrom(source: any = {}) {
	        return new ReorderServersRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.sourceGroupID = source["sourceGroupID"];
	        this.targetGroupID = source["targetGroupID"];
	        this.beforeServerID = source["beforeServerID"];
	        this.afterServerID = source["afterServerID"];
	    }
	}
	export class ResolveTerminalProfileRequest {
	    serverID: number;

	    static createFrom(source: any = {}) {
	        return new ResolveTerminalProfileRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	    }
	}
	export class RestartTunnelRequest {
	    serverID: number;
	    tunnelID: string;
	    auth: AuthRequest;

	    static createFrom(source: any = {}) {
	        return new RestartTunnelRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.tunnelID = source["tunnelID"];
	        this.auth = this.convertValues(source["auth"], AuthRequest);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SFTPCapabilities {
	    browse: string;
	    uploadFile: boolean;
	    downloadFile: boolean;
	    uploadDirectory: boolean;
	    downloadDirectory: boolean;
	    mkdir: boolean;
	    rename: boolean;
	    delete: boolean;
	    editText: boolean;

	    static createFrom(source: any = {}) {
	        return new SFTPCapabilities(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.browse = source["browse"];
	        this.uploadFile = source["uploadFile"];
	        this.downloadFile = source["downloadFile"];
	        this.uploadDirectory = source["uploadDirectory"];
	        this.downloadDirectory = source["downloadDirectory"];
	        this.mkdir = source["mkdir"];
	        this.rename = source["rename"];
	        this.delete = source["delete"];
	        this.editText = source["editText"];
	    }
	}
	export class SFTPContextRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    requestId: string;

	    static createFrom(source: any = {}) {
	        return new SFTPContextRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.requestId = source["requestId"];
	    }
	}
	export class SFTPDeleteRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    path: string;
	    paths: string[];
	    isDir: boolean;
	    recursive: boolean;
	    confirmToken: string;
	    expectedFileDir: string;

	    static createFrom(source: any = {}) {
	        return new SFTPDeleteRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.path = source["path"];
	        this.paths = source["paths"];
	        this.isDir = source["isDir"];
	        this.recursive = source["recursive"];
	        this.confirmToken = source["confirmToken"];
	        this.expectedFileDir = source["expectedFileDir"];
	    }
	}
	export class SFTPDownloadDirectoryRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    remotePath: string;
	    localDirectory: string;
	    conflictPolicy: string;
	    expectedFileDir: string;

	    static createFrom(source: any = {}) {
	        return new SFTPDownloadDirectoryRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.remotePath = source["remotePath"];
	        this.localDirectory = source["localDirectory"];
	        this.conflictPolicy = source["conflictPolicy"];
	        this.expectedFileDir = source["expectedFileDir"];
	    }
	}
	export class SFTPEntry {
	    name: string;
	    path: string;
	    parentPath: string;
	    size: number;
	    isDir: boolean;
	    isSymlink: boolean;
	    permissions: string;
	    owner: string;
	    group: string;
	    modTime: string;

	    static createFrom(source: any = {}) {
	        return new SFTPEntry(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.parentPath = source["parentPath"];
	        this.size = source["size"];
	        this.isDir = source["isDir"];
	        this.isSymlink = source["isSymlink"];
	        this.permissions = source["permissions"];
	        this.owner = source["owner"];
	        this.group = source["group"];
	        this.modTime = source["modTime"];
	    }
	}
	export class SFTPInspectDeleteRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    paths: string[];
	    recursive: boolean;

	    static createFrom(source: any = {}) {
	        return new SFTPInspectDeleteRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.paths = source["paths"];
	        this.recursive = source["recursive"];
	    }
	}
	export class SFTPInspectDeleteResponse {
	    connectionId: number;
	    contextId: string;
	    paths: string[];
	    fileCount: number;
	    directoryCount: number;
	    symlinkCount: number;
	    totalBytes: number;
	    warnings: string[];
	    requiresRecursive: boolean;

	    static createFrom(source: any = {}) {
	        return new SFTPInspectDeleteResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.paths = source["paths"];
	        this.fileCount = source["fileCount"];
	        this.directoryCount = source["directoryCount"];
	        this.symlinkCount = source["symlinkCount"];
	        this.totalBytes = source["totalBytes"];
	        this.warnings = source["warnings"];
	        this.requiresRecursive = source["requiresRecursive"];
	    }
	}
	export class SFTPItemProperties {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    generation: number;
	    requestId: string;
	    path: string;
	    name: string;
	    type: string;
	    size: number;
	    modTime: string;
	    permissions: string;
	    mode: number;
	    owner: string;
	    group: string;
	    isDir: boolean;
	    isSymlink: boolean;
	    symlinkTarget: string;
	    entry: SFTPEntry;

	    static createFrom(source: any = {}) {
	        return new SFTPItemProperties(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.generation = source["generation"];
	        this.requestId = source["requestId"];
	        this.path = source["path"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.size = source["size"];
	        this.modTime = source["modTime"];
	        this.permissions = source["permissions"];
	        this.mode = source["mode"];
	        this.owner = source["owner"];
	        this.group = source["group"];
	        this.isDir = source["isDir"];
	        this.isSymlink = source["isSymlink"];
	        this.symlinkTarget = source["symlinkTarget"];
	        this.entry = this.convertValues(source["entry"], SFTPEntry);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SFTPItemPropertiesRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    generation: number;
	    requestId: string;
	    path: string;

	    static createFrom(source: any = {}) {
	        return new SFTPItemPropertiesRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.generation = source["generation"];
	        this.requestId = source["requestId"];
	        this.path = source["path"];
	    }
	}
	export class SFTPListRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    path: string;
	    requestId: string;

	    static createFrom(source: any = {}) {
	        return new SFTPListRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.path = source["path"];
	        this.requestId = source["requestId"];
	    }
	}
	export class SFTPListResult {
	    connectionId: number;
	    contextId: string;
	    generation: number;
	    requestId: string;
	    mode: string;
	    path: string;
	    parentPath: string;
	    entries: SFTPEntry[];

	    static createFrom(source: any = {}) {
	        return new SFTPListResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.generation = source["generation"];
	        this.requestId = source["requestId"];
	        this.mode = source["mode"];
	        this.path = source["path"];
	        this.parentPath = source["parentPath"];
	        this.entries = this.convertValues(source["entries"], SFTPEntry);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SFTPMkdirRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    path: string;

	    static createFrom(source: any = {}) {
	        return new SFTPMkdirRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.path = source["path"];
	    }
	}
	export class SFTPReadTextFileRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    path: string;
	    maxBytes: number;
	    requestId: string;

	    static createFrom(source: any = {}) {
	        return new SFTPReadTextFileRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.path = source["path"];
	        this.maxBytes = source["maxBytes"];
	        this.requestId = source["requestId"];
	    }
	}
	export class SFTPReadTextFileResult {
	    connectionId: number;
	    contextId: string;
	    generation: number;
	    requestId: string;
	    path: string;
	    name: string;
	    size: number;
	    encoding: string;
	    contentHash: string;
	    truncated: boolean;
	    content: string;
	    detectedLanguage: string;
	    textKind: string;
	    entry: SFTPEntry;

	    static createFrom(source: any = {}) {
	        return new SFTPReadTextFileResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.generation = source["generation"];
	        this.requestId = source["requestId"];
	        this.path = source["path"];
	        this.name = source["name"];
	        this.size = source["size"];
	        this.encoding = source["encoding"];
	        this.contentHash = source["contentHash"];
	        this.truncated = source["truncated"];
	        this.content = source["content"];
	        this.detectedLanguage = source["detectedLanguage"];
	        this.textKind = source["textKind"];
	        this.entry = this.convertValues(source["entry"], SFTPEntry);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SFTPRenameRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    oldPath: string;
	    newPath: string;

	    static createFrom(source: any = {}) {
	        return new SFTPRenameRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.oldPath = source["oldPath"];
	        this.newPath = source["newPath"];
	    }
	}
	export class SFTPStatRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    path: string;

	    static createFrom(source: any = {}) {
	        return new SFTPStatRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.path = source["path"];
	    }
	}
	export class SFTPState {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    generation: number;
	    status: string;
	    active: boolean;
	    mode: string;
	    capabilities: SFTPCapabilities;
	    currentPath: string;
	    message: string;
	    updatedAt: string;

	    static createFrom(source: any = {}) {
	        return new SFTPState(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.generation = source["generation"];
	        this.status = source["status"];
	        this.active = source["active"];
	        this.mode = source["mode"];
	        this.capabilities = this.convertValues(source["capabilities"], SFTPCapabilities);
	        this.currentPath = source["currentPath"];
	        this.message = source["message"];
	        this.updatedAt = source["updatedAt"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SFTPTransferCancelRequest {
	    transferId: string;
	    contextId: string;

	    static createFrom(source: any = {}) {
	        return new SFTPTransferCancelRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.transferId = source["transferId"];
	        this.contextId = source["contextId"];
	    }
	}
	export class SFTPTransferControlRequest {
	    serverID: number;
	    contextID: string;
	    transferID: string;

	    static createFrom(source: any = {}) {
	        return new SFTPTransferControlRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.contextID = source["contextID"];
	        this.transferID = source["transferID"];
	    }
	}
	export class SFTPTransferControlResponse {
	    transferID: string;
	    status: string;

	    static createFrom(source: any = {}) {
	        return new SFTPTransferControlResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.transferID = source["transferID"];
	        this.status = source["status"];
	    }
	}
	export class SFTPTransferRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    localPath: string;
	    remotePath: string;
	    conflictPolicy: string;
	    expectedFileDir: string;

	    static createFrom(source: any = {}) {
	        return new SFTPTransferRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.localPath = source["localPath"];
	        this.remotePath = source["remotePath"];
	        this.conflictPolicy = source["conflictPolicy"];
	        this.expectedFileDir = source["expectedFileDir"];
	    }
	}
	export class SFTPTransferState {
	    id: string;
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    generation: number;
	    mode: string;
	    direction: string;
	    recursive: boolean;
	    sourceType: string;
	    localPath: string;
	    remotePath: string;
	    fileName: string;
	    currentFile: string;
	    totalBytes: number;
	    transferredBytes: number;
	    currentFileBytesDone: number;
	    currentFileBytesTotal: number;
	    resumeOffset: number;
	    filesTotal: number;
	    filesDone: number;
	    failedCount: number;
	    skippedCount: number;
	    percent: number;
	    speedBytesPerSecond: number;
	    status: string;
	    errorMessage: string;
	    pauseRequested: boolean;
	    cancelRequested: boolean;
	    canPause: boolean;
	    canResume: boolean;
	    canCancel: boolean;
	    cancelable: boolean;
	    startedAt: string;
	    finishedAt: string;

	    static createFrom(source: any = {}) {
	        return new SFTPTransferState(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.generation = source["generation"];
	        this.mode = source["mode"];
	        this.direction = source["direction"];
	        this.recursive = source["recursive"];
	        this.sourceType = source["sourceType"];
	        this.localPath = source["localPath"];
	        this.remotePath = source["remotePath"];
	        this.fileName = source["fileName"];
	        this.currentFile = source["currentFile"];
	        this.totalBytes = source["totalBytes"];
	        this.transferredBytes = source["transferredBytes"];
	        this.currentFileBytesDone = source["currentFileBytesDone"];
	        this.currentFileBytesTotal = source["currentFileBytesTotal"];
	        this.resumeOffset = source["resumeOffset"];
	        this.filesTotal = source["filesTotal"];
	        this.filesDone = source["filesDone"];
	        this.failedCount = source["failedCount"];
	        this.skippedCount = source["skippedCount"];
	        this.percent = source["percent"];
	        this.speedBytesPerSecond = source["speedBytesPerSecond"];
	        this.status = source["status"];
	        this.errorMessage = source["errorMessage"];
	        this.pauseRequested = source["pauseRequested"];
	        this.cancelRequested = source["cancelRequested"];
	        this.canPause = source["canPause"];
	        this.canResume = source["canResume"];
	        this.canCancel = source["canCancel"];
	        this.cancelable = source["cancelable"];
	        this.startedAt = source["startedAt"];
	        this.finishedAt = source["finishedAt"];
	    }
	}
	export class SFTPUpdateItemPermissionsRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    generation: number;
	    requestId: string;
	    path: string;
	    mode: number;
	    preserveSpecialBits: boolean;

	    static createFrom(source: any = {}) {
	        return new SFTPUpdateItemPermissionsRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.generation = source["generation"];
	        this.requestId = source["requestId"];
	        this.path = source["path"];
	        this.mode = source["mode"];
	        this.preserveSpecialBits = source["preserveSpecialBits"];
	    }
	}
	export class SFTPUploadDirectoryRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    localPath: string;
	    remoteDirectory: string;
	    conflictPolicy: string;
	    expectedFileDir: string;

	    static createFrom(source: any = {}) {
	        return new SFTPUploadDirectoryRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.localPath = source["localPath"];
	        this.remoteDirectory = source["remoteDirectory"];
	        this.conflictPolicy = source["conflictPolicy"];
	        this.expectedFileDir = source["expectedFileDir"];
	    }
	}
	export class SFTPWriteTextFileRequest {
	    connectionId: number;
	    contextId: string;
	    terminalSessionId: string;
	    path: string;
	    content: string;
	    expectedSize: number;
	    expectedMTime: string;
	    expectedHash: string;
	    encoding: string;
	    generation: number;
	    requestId: string;
	    mode: string;
	    conflictPolicy: string;
	    forceOverwrite: boolean;

	    static createFrom(source: any = {}) {
	        return new SFTPWriteTextFileRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.terminalSessionId = source["terminalSessionId"];
	        this.path = source["path"];
	        this.content = source["content"];
	        this.expectedSize = source["expectedSize"];
	        this.expectedMTime = source["expectedMTime"];
	        this.expectedHash = source["expectedHash"];
	        this.encoding = source["encoding"];
	        this.generation = source["generation"];
	        this.requestId = source["requestId"];
	        this.mode = source["mode"];
	        this.conflictPolicy = source["conflictPolicy"];
	        this.forceOverwrite = source["forceOverwrite"];
	    }
	}
	export class SFTPWriteTextFileResult {
	    connectionId: number;
	    contextId: string;
	    generation: number;
	    requestId: string;
	    path: string;
	    name: string;
	    size: number;
	    encoding: string;
	    contentHash: string;
	    entry: SFTPEntry;

	    static createFrom(source: any = {}) {
	        return new SFTPWriteTextFileResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.contextId = source["contextId"];
	        this.generation = source["generation"];
	        this.requestId = source["requestId"];
	        this.path = source["path"];
	        this.name = source["name"];
	        this.size = source["size"];
	        this.encoding = source["encoding"];
	        this.contentHash = source["contentHash"];
	        this.entry = this.convertValues(source["entry"], SFTPEntry);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SaveCommandFavoriteRequest {
	    id: string;
	    title: string;
	    command: string;
	    description: string;
	    scope: string;
	    serverId?: number;
	    groupId?: number;
	    tags: string[];
	    sortOrder: number;
	    allowSensitive: boolean;

	    static createFrom(source: any = {}) {
	        return new SaveCommandFavoriteRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.command = source["command"];
	        this.description = source["description"];
	        this.scope = source["scope"];
	        this.serverId = source["serverId"];
	        this.groupId = source["groupId"];
	        this.tags = source["tags"];
	        this.sortOrder = source["sortOrder"];
	        this.allowSensitive = source["allowSensitive"];
	    }
	}
	export class SaveConnectionRequest {
	    id: number;
	    groupId?: number;
	    name: string;
	    host: string;
	    port: number;
	    username: string;
	    authType: string;
	    privateKeySource: string;
	    privateKeyPath: string;
	    keyVaultId?: number;
	    terminalProfileId?: string;
	    connectionMode: string;
	    jumpServerId?: number;
	    refreshInterval: number;

	    static createFrom(source: any = {}) {
	        return new SaveConnectionRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.groupId = source["groupId"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.authType = source["authType"];
	        this.privateKeySource = source["privateKeySource"];
	        this.privateKeyPath = source["privateKeyPath"];
	        this.keyVaultId = source["keyVaultId"];
	        this.terminalProfileId = source["terminalProfileId"];
	        this.connectionMode = source["connectionMode"];
	        this.jumpServerId = source["jumpServerId"];
	        this.refreshInterval = source["refreshInterval"];
	    }
	}
	export class SaveConnectionConfigRequest {
	    connection: SaveConnectionRequest;
	    auth: AuthRequest;
	    connectAfterSave: boolean;

	    static createFrom(source: any = {}) {
	        return new SaveConnectionConfigRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connection = this.convertValues(source["connection"], SaveConnectionRequest);
	        this.auth = this.convertValues(source["auth"], AuthRequest);
	        this.connectAfterSave = source["connectAfterSave"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SaveConnectionConfigResult {
	    connection: Connection;
	    connectAfterSave: boolean;

	    static createFrom(source: any = {}) {
	        return new SaveConnectionConfigResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connection = this.convertValues(source["connection"], Connection);
	        this.connectAfterSave = source["connectAfterSave"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class SaveKeyVaultEntryRequest {
	    id: number;
	    name: string;
	    privateKeyPath: string;
	    passphrase: string;
	    rememberPassphrase: boolean;
	    updatePassphrase: boolean;
	    deletePassphrase: boolean;
	    notes: string;

	    static createFrom(source: any = {}) {
	        return new SaveKeyVaultEntryRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.privateKeyPath = source["privateKeyPath"];
	        this.passphrase = source["passphrase"];
	        this.rememberPassphrase = source["rememberPassphrase"];
	        this.updatePassphrase = source["updatePassphrase"];
	        this.deletePassphrase = source["deletePassphrase"];
	        this.notes = source["notes"];
	    }
	}
	export class SaveTerminalProfileRequest {
	    id: string;
	    name: string;
	    fontFamily: string;
	    fontSize: number;
	    lineHeight: number;
	    letterSpacing: number;
	    cursorStyle: string;
	    cursorBlink: boolean;
	    scrollback: number;
	    themeName: string;
	    foreground: string;
	    background: string;
	    selectionBackground: string;
	    cursorColor: string;

	    static createFrom(source: any = {}) {
	        return new SaveTerminalProfileRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.fontFamily = source["fontFamily"];
	        this.fontSize = source["fontSize"];
	        this.lineHeight = source["lineHeight"];
	        this.letterSpacing = source["letterSpacing"];
	        this.cursorStyle = source["cursorStyle"];
	        this.cursorBlink = source["cursorBlink"];
	        this.scrollback = source["scrollback"];
	        this.themeName = source["themeName"];
	        this.foreground = source["foreground"];
	        this.background = source["background"];
	        this.selectionBackground = source["selectionBackground"];
	        this.cursorColor = source["cursorColor"];
	    }
	}
	export class SaveTunnelProfileRequest {
	    id: number;
	    name: string;
	    serverID: number;
	    type: string;
	    bindHost: string;
	    bindPort: number;
	    targetHost: string;
	    targetPort: number;
	    remoteBindHost: string;
	    remoteBindPort: number;
	    autoStart: boolean;

	    static createFrom(source: any = {}) {
	        return new SaveTunnelProfileRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.serverID = source["serverID"];
	        this.type = source["type"];
	        this.bindHost = source["bindHost"];
	        this.bindPort = source["bindPort"];
	        this.targetHost = source["targetHost"];
	        this.targetPort = source["targetPort"];
	        this.remoteBindHost = source["remoteBindHost"];
	        this.remoteBindPort = source["remoteBindPort"];
	        this.autoStart = source["autoStart"];
	    }
	}
	export class ServiceJournalLine {
	    sequence: number;
	    timestamp?: string;
	    timestampText?: string;
	    priority: number;
	    priorityLabel: string;
	    identifier?: string;
	    pid?: string;
	    message: string;
	    truncated: boolean;

	    static createFrom(source: any = {}) {
	        return new ServiceJournalLine(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sequence = source["sequence"];
	        this.timestamp = source["timestamp"];
	        this.timestampText = source["timestampText"];
	        this.priority = source["priority"];
	        this.priorityLabel = source["priorityLabel"];
	        this.identifier = source["identifier"];
	        this.pid = source["pid"];
	        this.message = source["message"];
	        this.truncated = source["truncated"];
	    }
	}
	export class ServiceManagerCapability {
	    serverID: number;
	    available: boolean;
	    initSystem: string;
	    displayName?: string;
	    systemdVersion?: string;
	    distributionName?: string;
	    distributionVersion?: string;
	    supportsJournal: boolean;
	    supportsLiveLogs: boolean;
	    supportsResourceMetrics: boolean;
	    supportsStart: boolean;
	    supportsStop: boolean;
	    supportsRestart: boolean;
	    supportsEnable: boolean;
	    supportsDisable: boolean;
	    canManage: boolean;
	    requiresPrivilege: boolean;
	    error?: string;

	    static createFrom(source: any = {}) {
	        return new ServiceManagerCapability(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.available = source["available"];
	        this.initSystem = source["initSystem"];
	        this.displayName = source["displayName"];
	        this.systemdVersion = source["systemdVersion"];
	        this.distributionName = source["distributionName"];
	        this.distributionVersion = source["distributionVersion"];
	        this.supportsJournal = source["supportsJournal"];
	        this.supportsLiveLogs = source["supportsLiveLogs"];
	        this.supportsResourceMetrics = source["supportsResourceMetrics"];
	        this.supportsStart = source["supportsStart"];
	        this.supportsStop = source["supportsStop"];
	        this.supportsRestart = source["supportsRestart"];
	        this.supportsEnable = source["supportsEnable"];
	        this.supportsDisable = source["supportsDisable"];
	        this.canManage = source["canManage"];
	        this.requiresPrivilege = source["requiresPrivilege"];
	        this.error = source["error"];
	    }
	}
	export class ServiceManagerServerRequest {
	    serverID: number;

	    static createFrom(source: any = {}) {
	        return new ServiceManagerServerRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	    }
	}
	export class SetMonitorNetworkInterfaceRequest {
	    serverID: number;
	    mode: string;
	    selectedNetworkInterface: string;
	    userSelected: boolean;

	    static createFrom(source: any = {}) {
	        return new SetMonitorNetworkInterfaceRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.mode = source["mode"];
	        this.selectedNetworkInterface = source["selectedNetworkInterface"];
	        this.userSelected = source["userSelected"];
	    }
	}
	export class ShortcutConflictCheckRequest {
	    shortcuts: string[];

	    static createFrom(source: any = {}) {
	        return new ShortcutConflictCheckRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.shortcuts = source["shortcuts"];
	    }
	}
	export class ShortcutConflictEntry {
	    shortcut: string;
	    status: string;
	    message: string;

	    static createFrom(source: any = {}) {
	        return new ShortcutConflictEntry(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.shortcut = source["shortcut"];
	        this.status = source["status"];
	        this.message = source["message"];
	    }
	}
	export class ShortcutConflictCheckResponse {
	    entries: ShortcutConflictEntry[];

	    static createFrom(source: any = {}) {
	        return new ShortcutConflictCheckResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entries = this.convertValues(source["entries"], ShortcutConflictEntry);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}


	export class SignalProcessRequest {
	    serverID: number;
	    pid: number;
	    signal: string;
	    expectedCommand?: string;

	    static createFrom(source: any = {}) {
	        return new SignalProcessRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.pid = source["pid"];
	        this.signal = source["signal"];
	        this.expectedCommand = source["expectedCommand"];
	    }
	}
	export class SignalProcessResponse {
	    serverID: number;
	    pid: number;
	    success: boolean;
	    message: string;

	    static createFrom(source: any = {}) {
	        return new SignalProcessResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.pid = source["pid"];
	        this.success = source["success"];
	        this.message = source["message"];
	    }
	}
	export class StartBatchCommandRequest {
	    command: string;
	    serverIDs: number[];
	    timeoutSeconds: number;
	    concurrency: number;

	    static createFrom(source: any = {}) {
	        return new StartBatchCommandRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.command = source["command"];
	        this.serverIDs = source["serverIDs"];
	        this.timeoutSeconds = source["timeoutSeconds"];
	        this.concurrency = source["concurrency"];
	    }
	}
	export class StartNetworkDiagnosticRequest {
	    serverID: number;
	    type: string;
	    target: string;
	    port?: number;
	    count?: number;
	    timeoutSeconds?: number;

	    static createFrom(source: any = {}) {
	        return new StartNetworkDiagnosticRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.type = source["type"];
	        this.target = source["target"];
	        this.port = source["port"];
	        this.count = source["count"];
	        this.timeoutSeconds = source["timeoutSeconds"];
	    }
	}
	export class StartProcessWatchRequest {
	    serverID: number;
	    watchID?: string;
	    query?: string;
	    sortBy: string;
	    sortDir: string;
	    limit?: number;
	    intervalMs?: number;

	    static createFrom(source: any = {}) {
	        return new StartProcessWatchRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.watchID = source["watchID"];
	        this.query = source["query"];
	        this.sortBy = source["sortBy"];
	        this.sortDir = source["sortDir"];
	        this.limit = source["limit"];
	        this.intervalMs = source["intervalMs"];
	    }
	}
	export class StartTunnelRequest {
	    serverID: number;
	    profileID: number;
	    type: string;
	    name: string;
	    bindHost: string;
	    bindPort: number;
	    targetHost: string;
	    targetPort: number;
	    remoteBindHost: string;
	    remoteBindPort: number;
	    confirmPublicBind: boolean;
	    auth: AuthRequest;

	    static createFrom(source: any = {}) {
	        return new StartTunnelRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.profileID = source["profileID"];
	        this.type = source["type"];
	        this.name = source["name"];
	        this.bindHost = source["bindHost"];
	        this.bindPort = source["bindPort"];
	        this.targetHost = source["targetHost"];
	        this.targetPort = source["targetPort"];
	        this.remoteBindHost = source["remoteBindHost"];
	        this.remoteBindPort = source["remoteBindPort"];
	        this.confirmPublicBind = source["confirmPublicBind"];
	        this.auth = this.convertValues(source["auth"], AuthRequest);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class StopProcessWatchRequest {
	    serverID: number;
	    watchID: string;

	    static createFrom(source: any = {}) {
	        return new StopProcessWatchRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.watchID = source["watchID"];
	    }
	}
	export class StopSystemServiceJournalFollowRequest {
	    serverID: number;
	    watchID: string;

	    static createFrom(source: any = {}) {
	        return new StopSystemServiceJournalFollowRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.watchID = source["watchID"];
	    }
	}
	export class StopTunnelRequest {
	    serverID: number;
	    tunnelID: string;

	    static createFrom(source: any = {}) {
	        return new StopTunnelRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.tunnelID = source["tunnelID"];
	    }
	}
	export class SystemServiceActionRequest {
	    serverID: number;
	    unitName: string;
	    serviceID?: string;

	    static createFrom(source: any = {}) {
	        return new SystemServiceActionRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.unitName = source["unitName"];
	        this.serviceID = source["serviceID"];
	    }
	}
	export class SystemServiceActionResponse {
	    serverID: number;
	    serviceID?: string;
	    unitName: string;
	    action: string;
	    success: boolean;
	    message: string;
	    timestamp: string;

	    static createFrom(source: any = {}) {
	        return new SystemServiceActionResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.serviceID = source["serviceID"];
	        this.unitName = source["unitName"];
	        this.action = source["action"];
	        this.success = source["success"];
	        this.message = source["message"];
	        this.timestamp = source["timestamp"];
	    }
	}
	export class SystemServiceDetail {
	    serverID: number;
	    initSystem: string;
	    serviceID: string;
	    unitName: string;
	    displayName?: string;
	    description: string;
	    startupState?: string;
	    loadState: string;
	    activeState: string;
	    subState: string;
	    unitFileState: string;
	    activeStateLabel: string;
	    unitFileStateLabel: string;
	    mainPID: number;
	    memoryCurrentBytes?: number;
	    cpuUsageNSec?: number;
	    tasksCurrent?: number;
	    restartCount?: number;
	    fragmentPath?: string;
	    scriptPath?: string;
	    distributionName?: string;
	    distributionVersion?: string;
	    lastUpdatedAt?: string;
	    result?: string;
	    startedAt?: string;
	    exitedAt?: string;
	    partial: boolean;
	    warnings?: string[];
	    critical: boolean;
	    protected: boolean;

	    static createFrom(source: any = {}) {
	        return new SystemServiceDetail(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.initSystem = source["initSystem"];
	        this.serviceID = source["serviceID"];
	        this.unitName = source["unitName"];
	        this.displayName = source["displayName"];
	        this.description = source["description"];
	        this.startupState = source["startupState"];
	        this.loadState = source["loadState"];
	        this.activeState = source["activeState"];
	        this.subState = source["subState"];
	        this.unitFileState = source["unitFileState"];
	        this.activeStateLabel = source["activeStateLabel"];
	        this.unitFileStateLabel = source["unitFileStateLabel"];
	        this.mainPID = source["mainPID"];
	        this.memoryCurrentBytes = source["memoryCurrentBytes"];
	        this.cpuUsageNSec = source["cpuUsageNSec"];
	        this.tasksCurrent = source["tasksCurrent"];
	        this.restartCount = source["restartCount"];
	        this.fragmentPath = source["fragmentPath"];
	        this.scriptPath = source["scriptPath"];
	        this.distributionName = source["distributionName"];
	        this.distributionVersion = source["distributionVersion"];
	        this.lastUpdatedAt = source["lastUpdatedAt"];
	        this.result = source["result"];
	        this.startedAt = source["startedAt"];
	        this.exitedAt = source["exitedAt"];
	        this.partial = source["partial"];
	        this.warnings = source["warnings"];
	        this.critical = source["critical"];
	        this.protected = source["protected"];
	    }
	}
	export class SystemServiceJournalFollowResponse {
	    watchID: string;
	    serverID: number;
	    unitName: string;
	    startedAt: string;

	    static createFrom(source: any = {}) {
	        return new SystemServiceJournalFollowResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.watchID = source["watchID"];
	        this.serverID = source["serverID"];
	        this.unitName = source["unitName"];
	        this.startedAt = source["startedAt"];
	    }
	}
	export class SystemServiceJournalRequest {
	    serverID: number;
	    unitName: string;
	    lineLimit: number;
	    priority: string;
	    currentBootOnly: boolean;

	    static createFrom(source: any = {}) {
	        return new SystemServiceJournalRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.unitName = source["unitName"];
	        this.lineLimit = source["lineLimit"];
	        this.priority = source["priority"];
	        this.currentBootOnly = source["currentBootOnly"];
	    }
	}
	export class SystemServiceJournalResponse {
	    serverID: number;
	    unitName: string;
	    lines: ServiceJournalLine[];
	    fallback: boolean;
	    timestamp: string;

	    static createFrom(source: any = {}) {
	        return new SystemServiceJournalResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.unitName = source["unitName"];
	        this.lines = this.convertValues(source["lines"], ServiceJournalLine);
	        this.fallback = source["fallback"];
	        this.timestamp = source["timestamp"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SystemServiceSummary {
	    serverID: number;
	    initSystem: string;
	    serviceID: string;
	    unitName: string;
	    displayName: string;
	    description: string;
	    startupState?: string;
	    loadState: string;
	    activeState: string;
	    subState: string;
	    unitFileState: string;
	    activeStateLabel: string;
	    unitFileStateLabel: string;
	    isActive: boolean;
	    isFailed: boolean;
	    isEnabled: boolean;
	    canStart: boolean;
	    canStop: boolean;
	    canRestart: boolean;
	    canEnable: boolean;
	    canDisable: boolean;
	    critical: boolean;
	    protected: boolean;

	    static createFrom(source: any = {}) {
	        return new SystemServiceSummary(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.initSystem = source["initSystem"];
	        this.serviceID = source["serviceID"];
	        this.unitName = source["unitName"];
	        this.displayName = source["displayName"];
	        this.description = source["description"];
	        this.startupState = source["startupState"];
	        this.loadState = source["loadState"];
	        this.activeState = source["activeState"];
	        this.subState = source["subState"];
	        this.unitFileState = source["unitFileState"];
	        this.activeStateLabel = source["activeStateLabel"];
	        this.unitFileStateLabel = source["unitFileStateLabel"];
	        this.isActive = source["isActive"];
	        this.isFailed = source["isFailed"];
	        this.isEnabled = source["isEnabled"];
	        this.canStart = source["canStart"];
	        this.canStop = source["canStop"];
	        this.canRestart = source["canRestart"];
	        this.canEnable = source["canEnable"];
	        this.canDisable = source["canDisable"];
	        this.critical = source["critical"];
	        this.protected = source["protected"];
	    }
	}
	export class SystemServiceListResponse {
	    serverID: number;
	    services: SystemServiceSummary[];
	    timestamp: string;

	    static createFrom(source: any = {}) {
	        return new SystemServiceListResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serverID = source["serverID"];
	        this.services = this.convertValues(source["services"], SystemServiceSummary);
	        this.timestamp = source["timestamp"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class TerminalProfile {
	    id: string;
	    name: string;
	    fontFamily: string;
	    fontSize: number;
	    lineHeight: number;
	    letterSpacing: number;
	    cursorStyle: string;
	    cursorBlink: boolean;
	    scrollback: number;
	    themeName: string;
	    foreground: string;
	    background: string;
	    selectionBackground: string;
	    cursorColor: string;
	    createdAt: string;
	    updatedAt: string;

	    static createFrom(source: any = {}) {
	        return new TerminalProfile(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.fontFamily = source["fontFamily"];
	        this.fontSize = source["fontSize"];
	        this.lineHeight = source["lineHeight"];
	        this.letterSpacing = source["letterSpacing"];
	        this.cursorStyle = source["cursorStyle"];
	        this.cursorBlink = source["cursorBlink"];
	        this.scrollback = source["scrollback"];
	        this.themeName = source["themeName"];
	        this.foreground = source["foreground"];
	        this.background = source["background"];
	        this.selectionBackground = source["selectionBackground"];
	        this.cursorColor = source["cursorColor"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class TerminalResizeRequest {
	    sessionId: string;
	    columns: number;
	    rows: number;

	    static createFrom(source: any = {}) {
	        return new TerminalResizeRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.columns = source["columns"];
	        this.rows = source["rows"];
	    }
	}
	export class TerminalWriteRequest {
	    sessionId: string;
	    dataBase64: string;

	    static createFrom(source: any = {}) {
	        return new TerminalWriteRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.dataBase64 = source["dataBase64"];
	    }
	}
	export class TestConnectionResult {
	    success: boolean;
	    latencyMillis: number;
	    hostKeyFingerprint: string;
	    errorCode: string;
	    message: string;
	    connectionError?: ConnectionError;

	    static createFrom(source: any = {}) {
	        return new TestConnectionResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.latencyMillis = source["latencyMillis"];
	        this.hostKeyFingerprint = source["hostKeyFingerprint"];
	        this.errorCode = source["errorCode"];
	        this.message = source["message"];
	        this.connectionError = this.convertValues(source["connectionError"], ConnectionError);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class TrustHostKeyRequest {
	    connectionId: number;
	    expectedFingerprint: string;

	    static createFrom(source: any = {}) {
	        return new TrustHostKeyRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connectionId = source["connectionId"];
	        this.expectedFingerprint = source["expectedFingerprint"];
	    }
	}
	export class TunnelProfile {
	    id: number;
	    name: string;
	    serverID: number;
	    type: string;
	    bindHost: string;
	    bindPort: number;
	    targetHost: string;
	    targetPort: number;
	    remoteBindHost: string;
	    remoteBindPort: number;
	    autoStart: boolean;
	    createdAt: string;
	    updatedAt: string;

	    static createFrom(source: any = {}) {
	        return new TunnelProfile(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.serverID = source["serverID"];
	        this.type = source["type"];
	        this.bindHost = source["bindHost"];
	        this.bindPort = source["bindPort"];
	        this.targetHost = source["targetHost"];
	        this.targetPort = source["targetPort"];
	        this.remoteBindHost = source["remoteBindHost"];
	        this.remoteBindPort = source["remoteBindPort"];
	        this.autoStart = source["autoStart"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}

	export class UpdateCommandHistoryRequest {
	    id: string;
	    command: string;

	    static createFrom(source: any = {}) {
	        return new UpdateCommandHistoryRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.command = source["command"];
	    }
	}
	export class UpdateCommandHistoryResult {
	    entry: CommandHistoryEntry;

	    static createFrom(source: any = {}) {
	        return new UpdateCommandHistoryResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entry = this.convertValues(source["entry"], CommandHistoryEntry);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ValidatePrivateKeyFileRequest {
	    privateKeyPath: string;
	    passphrase: string;

	    static createFrom(source: any = {}) {
	        return new ValidatePrivateKeyFileRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.privateKeyPath = source["privateKeyPath"];
	        this.passphrase = source["passphrase"];
	    }
	}

}

export namespace terminal {

	export class SessionInfo {
	    sessionId: string;
	    connectionId: number;
	    title: string;
	    status: string;
	    code: string;
	    message: string;
	    connectionError?: domain.ConnectionError;

	    static createFrom(source: any = {}) {
	        return new SessionInfo(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.connectionId = source["connectionId"];
	        this.title = source["title"];
	        this.status = source["status"];
	        this.code = source["code"];
	        this.message = source["message"];
	        this.connectionError = this.convertValues(source["connectionError"], domain.ConnectionError);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

import Environment from "../Environment";
import File from "../util/File";
import {ControlProtocolMode, DEFAULT_KEY, DEFAULT_SESSION_TTL_MS, resolveSessionTtlMs, resolveAuditRetentionDays, resolveAuditQueueSize, resolveLogLevel, resolveCloseStallMs, resolveCloseGraceMs, HttpOption, ServerOption, TunnelingOption, normalizeRateLimit, defaultRateLimit, BlocklistEntry} from "../types/TunnelingOption";
import YAML from "yaml";
import Files, {AtomicFileValue} from "../util/Files";
import ObjectUtil from "../util/ObjectUtil";
import LoggerFactory from "../util/logger/LoggerFactory";
import {TCPServer} from "../util/TCPServer";
import fs from "fs";
import {createOpaqueToken} from "../commons/ProtocolV2";
import {redactSecrets} from "../util/SecretRedactor";
import {createInitialRevisionState, RevisionState} from "./RevisionState";
import {normalizeConnectionSecurity} from "./security/connectionSecurity";
import {dropBlocklistPort, dropOrphanBlocklistEntries} from "./security/IpBlocklist";

/** 터널 행을 넣거나 뺀 서버 설정. droppedBlocks 는 그 포트에서 함께 빠진 차단 항목이다(#286, 감사용). */
type ComposedServerOption = {success: boolean, message: string, serverOption?: ServerOption, droppedBlocks?: BlocklistEntry[]};

const logger = LoggerFactory.getLogger('server', 'ServerOptionStore');

interface ServerOptionUpdateCallback {
    (serverOption: ServerOption): void;
}

type TunnelingOptionNormalizationMode = "new-config" | "legacy-load";

const OPTION_FILE_NAME: string = 'server.yaml';
const OPTION_STATE_FILE_NAME: string = '.server.state.json';
const ROLLBACK_BACKUP_SUFFIX: string = '.bak';

// U2-09 / #101: 업그레이드 롤백 계약. 저장되는 옵션이 이 필드 가운데 하나라도 담고 있고
// 디스크의 server.yaml 에는 하나도 없으면, 그 저장과 같은 배치로 직전 두 파일을 .bak 으로 남긴다.
// 이전 바이너리는 verificationServerOption 에 허용 목록이 없어 새 필드가 든 yaml 도 읽으므로,
// .bak 은 수기 편집 손실을 막기 위한 복원 지점이다(설계 §3.1).
const ROLLBACK_SENSITIVE_TOP_FIELDS = ['connectionSecurity', 'mfaRequiredForSuperusers', 'auditRetentionDays', 'auditQueueSize', 'logLevel', 'closeStallMs', 'closeGraceMs'] as const;
const ROLLBACK_SENSITIVE_TUNNEL_FIELDS = ['ownerId', 'rateLimit'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const hasRollbackSensitiveField = (option: unknown): boolean => {
    if(!isRecord(option)) return false;
    if(ROLLBACK_SENSITIVE_TOP_FIELDS.some((field) => option[field] !== undefined)) return true;
    const tunnels = option['tunnelingOptions'];
    if(!Array.isArray(tunnels)) return false;
    return tunnels.some((tunnel) => isRecord(tunnel)
        && ROLLBACK_SENSITIVE_TUNNEL_FIELDS.some((field) => tunnel[field] !== undefined));
};

type ConfigLoadStatus = {ready: true; source: 'loaded' | 'created' | 'reset'} |
    {ready: false; reason: 'non-file' | 'read-error' | 'empty' | 'parse' | 'validation'};

class ServerOptionStore {

    private static _instance : ServerOptionStore;
    private readonly _configFile : File;
    private readonly _stateFile : File;
    private _serverOption : ServerOption;
    private _loadStatus: ConfigLoadStatus = {ready: false, reason: 'empty'};

    public get loadStatus(): ConfigLoadStatus { return {...this._loadStatus}; }
    public readServerOption(): {success: true; serverOption: ServerOption} | {success: false; message: string} {
        return this._loadStatus.ready ? {success: true, serverOption: this.serverOption} : {success: false, message: 'server configuration is not ready'};
    }
    private assertReady(): void {
        if(!this._loadStatus.ready) throw new Error('server configuration is not ready');
    }
    private _revisionState: RevisionState;
    private _serverOptionUpdateCallback? : ServerOptionUpdateCallback;
    private _configurationMutation: Promise<void> = Promise.resolve();

    public async runConfigurationMutation(operation: () => Promise<void>): Promise<void> {
        const previous = this._configurationMutation;
        let release!: () => void;
        this._configurationMutation = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try {
            await operation();
        } finally {
            release();
        }
    }

    public get serverOption() : ServerOption {
        this.assertReady();
        //delete result['tunnelingOptions'];
        return ObjectUtil.cloneDeep(this._serverOption);
    }

    public set onServerOptionUpdateCallback(callback: ServerOptionUpdateCallback | undefined)  {
        this._serverOptionUpdateCallback = callback;
    }

    public get revisionState(): RevisionState {
        this.assertReady();
        return ObjectUtil.cloneDeep(this._revisionState);
    }

    public prepareServerOption(serverOption: ServerOption): {success: boolean, message: string, serverOption?: ServerOption} {
        if(!this._loadStatus.ready) return {success: false, message: 'server configuration is not ready'};
        if(!serverOption.tunnelingOptions) {
            serverOption.tunnelingOptions = this._serverOption.tunnelingOptions;
        }
        return this.verificationServerOption(serverOption);
    }

    public composeServerOptionWithTunnelingOption(tunnelingOption: TunnelingOption): ComposedServerOption {
        if(!this._loadStatus.ready) return {success: false, message: 'server configuration is not ready'};
        const normalizedOption = ObjectUtil.cloneDeep(tunnelingOption);
        const result = this.verificationTunnelingOption(normalizedOption);
        if(!result.success) {
            return {success: false, message: result.message};
        }
        const serverOption = this.serverOption;
        const index = serverOption.tunnelingOptions.findIndex((option) => option.forwardPort == tunnelingOption.forwardPort);
        let droppedBlocks: BlocklistEntry[] = [];
        if(index < 0) {
            serverOption.tunnelingOptions.push(normalizedOption);
            // 새 터널 API 는 포트가 비어 있는지 확인한 뒤에 저장하므로 옛 리스너가 이미 없다.
            droppedBlocks = ServerOptionStore.releaseOrphanBlocks(serverOption, [normalizedOption.forwardPort]);
        } else {
            serverOption.tunnelingOptions[index] = normalizedOption;
        }
        return {success: true, message: "", serverOption, droppedBlocks};
    }

    /**
     * #286 새로 터널이 쓰게 된 포트에 남아 있던 고아 차단 항목(지운 터널의 것)을 빼고, 뺀 항목을 돌려준다(감사용).
     * 새 터널이 옛 터널의 차단을 물려받지 않게 한다. 옛 리스너가 아직 도는 포트는 호출자가 ports 에서 뺀다
     * (그 리스너가 도는 동안은 계속 막는다). serverOption 을 그 자리에서 바꾼다.
     */
    public static releaseOrphanBlocks(serverOption: Pick<ServerOption, 'connectionSecurity'>, ports: Iterable<number>): BlocklistEntry[] {
        const security = serverOption.connectionSecurity;
        if(!security) return [];
        let dropped: BlocklistEntry[] = [];
        for(const port of ports) {
            const result = dropBlocklistPort(security.blocklist ?? [], port);
            security.blocklist = result.entries;
            dropped = [...dropped, ...result.dropped];
        }
        return dropped;
    }

    public composeServerOptionWithoutTunnelingOption(forwardPort: number): ComposedServerOption {
        if(!this._loadStatus.ready) return {success: false, message: 'server configuration is not ready'};
        const serverOption = this.serverOption;
        const index = serverOption.tunnelingOptions.findIndex((option) => option.forwardPort == forwardPort);
        if(index < 0) {
            return {success: false, message: `forwardPort ${forwardPort} is not registered`};
        }
        serverOption.tunnelingOptions.splice(index, 1);
        // #286 그 터널에만 건 차단 항목도 함께 지운다.
        let droppedBlocks: BlocklistEntry[] = [];
        if(serverOption.connectionSecurity) {
            const result = dropBlocklistPort(serverOption.connectionSecurity.blocklist ?? [], forwardPort);
            serverOption.connectionSecurity.blocklist = result.entries;
            droppedBlocks = result.dropped;
        }
        return {success: true, message: "", serverOption, droppedBlocks};
    }

    public commitPreparedServerOption(
        serverOption: ServerOption,
        options: {markLastKnownGood?: boolean, pendingRestartScopes?: string[]} = {}
    ): {success: boolean, message: string, revisionState?: RevisionState} {
        if(!this._loadStatus.ready) return {success: false, message: 'server configuration is not ready'};
        const result = this.prepareServerOptionCommit(serverOption, options);
        if(!result.prepared) return {success: false, message: result.message};
        Files.writeAtomicBatchSync(result.prepared.files);
        this.publishPreparedServerOption(result.prepared);
        return {success: true, message: "", revisionState: this.revisionState};
    }

    public prepareServerOptionCommit(serverOption: ServerOption,
        options: {markLastKnownGood?: boolean, pendingRestartScopes?: string[]} = {}) {
        if(!this._loadStatus.ready) return {success: false, message: 'server configuration is not ready'};
        const result = this.prepareServerOption(ObjectUtil.cloneDeep(serverOption));
        if(!result.success) {
            return {success: false, message: result.message};
        }
        const updatedValues = ObjectUtil.findUpdates(this._serverOption, result.serverOption!);
        logger.info(`commitPreparedServerOption - ${JSON.stringify(redactSecrets(updatedValues))}`);
        const revisionState = this.revisionState;
        revisionState.currentRevision += 1;
        revisionState.lastCommittedAt = Date.now();
        revisionState.pendingRestartScopes = [...new Set([...revisionState.pendingRestartScopes, ...(options.pendingRestartScopes ?? [])])];
        if(options.markLastKnownGood !== false && revisionState.pendingRestartScopes.length === 0) {
            revisionState.lastKnownGoodRevision = revisionState.currentRevision;
            revisionState.lastKnownGoodAt = revisionState.lastCommittedAt;
        }
        revisionState.lastRollback = undefined;
        const files: AtomicFileValue[] = [
            ...this.rollbackBackupFiles(serverOption),
            {file: this._configFile, data: YAML.stringify(result.serverOption), mode: 0o600},
            {file: this._stateFile, data: JSON.stringify(revisionState, null, 2), mode: 0o600},
        ];
        return {success: true, message: "", prepared: {serverOption: result.serverOption!, revisionState, files}};
    }

    /**
     * U2-09 / #101: 업그레이드 직전의 server.yaml·.server.state.json 을 한 번만 .bak 으로 남긴다.
     * 판정은 호출자가 넘긴 옵션(정규화 전)과 디스크의 server.yaml 원문으로 한다. 정규화된 옵션은
     * connectionSecurity·rateLimit 을 항상 채우므로 판정 기준이 되지 못한다.
     * 남길 이유가 없으면 빈 배열이고, 서버는 이 파일을 어떤 경로에서도 지우지 않는다.
     */
    private rollbackBackupFiles(next: ServerOption): AtomicFileValue[] {
        const backupConfigFile = new File(`${this._configFile.toString()}${ROLLBACK_BACKUP_SUFFIX}`);
        if(backupConfigFile.isFile()) return [];
        if(!this._configFile.isFile()) return [];
        const currentYaml = fs.readFileSync(this._configFile.toString());
        let storedOption: unknown;
        // YAML 파싱만이 이 메서드의 예외 경계다. 읽을 수 없는 yaml 은 복원 지점이 될 수 없으므로 남기지 않는다.
        try { storedOption = YAML.parse(currentYaml.toString('utf-8')); }
        catch { return []; }
        if(hasRollbackSensitiveField(storedOption)) return [];
        if(!hasRollbackSensitiveField(next)) return [];
        const files: AtomicFileValue[] = [{file: backupConfigFile, data: currentYaml, mode: 0o600}];
        if(this._stateFile.isFile()) {
            files.push({
                file: new File(`${this._stateFile.toString()}${ROLLBACK_BACKUP_SUFFIX}`),
                data: fs.readFileSync(this._stateFile.toString()),
                mode: 0o600
            });
        }
        return files;
    }

    public publishPreparedServerOption(prepared: NonNullable<ReturnType<ServerOptionStore['prepareServerOptionCommit']>['prepared']>): boolean {
        if(!this._loadStatus.ready) return false;
        this._serverOption = ObjectUtil.cloneDeep(prepared.serverOption);
        this._revisionState = ObjectUtil.cloneDeep(prepared.revisionState);
        return true;
    }

    public captureCommittedState() {
        this.assertReady();
        return {serverOption: this.serverOption, revisionState: this.revisionState,
            files: Files.captureFiles([this._configFile, this._stateFile])};
    }

    public restoreCommittedState(state: ReturnType<ServerOptionStore['captureCommittedState']>): boolean {
        if(!this._loadStatus.ready) return false;
        Files.writeAtomicBatchSync(state.files);
        this._serverOption = ObjectUtil.cloneDeep(state.serverOption);
        this._revisionState = ObjectUtil.cloneDeep(state.revisionState);
        return true;
    }

    public markLastKnownGood(revision?: number, pendingRestartScopes: string[] = []): boolean {
        if(!this._loadStatus.ready) return false;
        revision ??= this._revisionState.currentRevision;
        this._revisionState.lastKnownGoodRevision = revision;
        this._revisionState.lastKnownGoodAt = Date.now();
        this._revisionState.pendingRestartScopes = [...pendingRestartScopes];
        if(pendingRestartScopes.length == 0 && revision == this._revisionState.currentRevision) {
            this._revisionState.lastRollback = undefined;
        }
        this.saveRevisionState();
        return true;
    }

    public recordRollback(reason: string, failedScopes: string[], attemptedRevision?: number, restoredRevision?: number): boolean {
        if(!this._loadStatus.ready) return false;
        restoredRevision ??= this._revisionState.currentRevision;
        const revisionState = this.revisionState;
        revisionState.lastRollback = {at: Date.now(), reason, failedScopes: [...failedScopes],
            attemptedRevision: attemptedRevision ?? (revisionState.currentRevision + 1), restoredRevision};
        Files.writeAtomicBatchSync([{file: this._stateFile, data: JSON.stringify(revisionState, null, 2), mode: 0o600}]);
        this._revisionState = revisionState;
        return true;
    }

    public updateServerOption(serverOption: ServerOption): boolean {
        const result = this.commitPreparedServerOption(serverOption);
        if(result.success) {
            process.nextTick(() => {
                this._serverOptionUpdateCallback?.(ObjectUtil.cloneDeep(this._serverOption));
            });
            return true;
        }
        return false;
    }

    public removeTunnelingOption(forwardPort: number) : boolean {
        const result = this.composeServerOptionWithoutTunnelingOption(forwardPort);
        if(!result.success) {
            return false;
        }
        return this.commitPreparedServerOption(result.serverOption!).success;
    }

    public updateTunnelingOption(tunnelingOption: TunnelingOption): boolean {
        const result = this.composeServerOptionWithTunnelingOption(tunnelingOption);
        if(!result.success) {
            return false;
        }
        return this.commitPreparedServerOption(result.serverOption!).success;
    }

    public getTunnelingOptions() : Array<TunnelingOption> {
        this.assertReady();
        let result : Array<TunnelingOption> = [];
        for(let option of this._serverOption.tunnelingOptions) {
            result.push(ObjectUtil.cloneDeep(option));
        }
        return result;
    }


    public getTunnelingOption(forwardPort: number) : TunnelingOption | undefined {
        this.assertReady();
        for(let option of this._serverOption.tunnelingOptions) {
            if(option.forwardPort == forwardPort) {
                return ObjectUtil.cloneDeep(option);
            }
        }
        return undefined;
    }



    public static get instance() : ServerOptionStore {
        if(!ServerOptionStore._instance) {
            ServerOptionStore._instance = new ServerOptionStore();
        }
        return ServerOptionStore._instance;
    }

    public static resetForTest(): void {
        ServerOptionStore._instance = undefined as any;
    }

    constructor() {
        let configDir : string = Environment.path.configDir;
        let configDirFile = new File(configDir);
        if(!configDirFile.isDirectory()) configDirFile.mkdirs();
        this._configFile = new File(configDir, OPTION_FILE_NAME);
        this._stateFile = new File(configDir, OPTION_STATE_FILE_NAME);
        this._revisionState = this.loadRevisionState();
        let stat: fs.Stats;
        try { stat = fs.statSync(this._configFile.toString()); }
        catch(error) {
            if((error as NodeJS.ErrnoException).code === 'ENOENT') {
                try { fs.lstatSync(this._configFile.toString()); }
                catch(entryError) {
                    if((entryError as NodeJS.ErrnoException).code === 'ENOENT') { this.initializeDefaults('created'); return; }
                }
            }
            this._loadStatus = {ready: false, reason: 'read-error'}; return;
        }
        if(!stat.isFile()) { this._loadStatus = {ready: false, reason: 'non-file'}; return; }
        this.load();
    }

    public save() : boolean {
        if(!this._loadStatus.ready) return false;
        let yamlString : string = YAML.stringify(this._serverOption);
        Files.writeAtomicSync(this._configFile, yamlString);
        try {
            fs.chmodSync(this._configFile.toString(), 0o600);
        } catch {}
        this.saveRevisionState();
        return true;
    }

    public reset() : void {
        logger.info(`reset`);
        if(this._configFile.isFile()) {
            this._configFile.delete();
        }
        if(this._stateFile.isFile()) {
            this._stateFile.delete();
        }
        this._loadStatus = {ready: false, reason: 'empty'};
        this.initializeDefaults('reset');
    }

    private initializeDefaults(source: 'created' | 'reset'): void {
        const option = this.makeDefaultOption(), revision = createInitialRevisionState();
        Files.writeAtomicBatchSync([{file: this._configFile, data: YAML.stringify(option), mode: 0o600},
            {file: this._stateFile, data: JSON.stringify(revision, null, 2), mode: 0o600}]);
        this._serverOption = option; this._revisionState = revision; this._loadStatus = {ready: true, source};
    }

    private load(): void {
        let text: string;
        try { text = fs.readFileSync(this._configFile.toString(), 'utf8'); }
        catch { this._loadStatus = {ready: false, reason: 'read-error'}; return; }
        if(text.trim().length === 0) { this._loadStatus = {ready: false, reason: 'empty'}; return; }
        let candidate: ServerOption;
        try { candidate = YAML.parse(text); }
        catch(error) {
            if(error instanceof YAML.YAMLParseError) { this._loadStatus = {ready: false, reason: 'parse'}; return; }
            throw error;
        }
        const record = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);
        if(!record(candidate) || (candidate.adminBindHost != undefined && typeof candidate.adminBindHost !== 'string') ||
            (candidate.tunnelingOptions && (!Array.isArray(candidate.tunnelingOptions) ||
            !candidate.tunnelingOptions.every(option => record(option) && (!option.httpOption ||
                (record(option.httpOption) && [option.httpOption.bodyRewriteRules, option.httpOption.customRequestHeaders, option.httpOption.customResponseHeaders].every(value =>
                    value === undefined || (Array.isArray(value) && value.every(record)))))))) ||
            (candidate.trustedClients && (!Array.isArray(candidate.trustedClients) ||
                !candidate.trustedClients.every(client => {
                    if(!record(client)) return false;
                    if(!client.clientId) return true;
                    if(typeof client.clientId !== 'string') return false;
                    if(!client.clientId.trim() || !client.clientSecret) return true;
                    if(typeof client.clientSecret !== 'string') return false;
                    return !client.clientSecret.trim() || client.displayName == undefined || typeof client.displayName === 'string';
                })))) {
            this._loadStatus = {ready: false, reason: 'validation'}; return;
        }
        this.preserveLegacyDefaults(candidate);
        if(!this.verificationServerOption(candidate).success ||
            candidate.tunnelingOptions.some(option => !this.verificationTunnelingOption(option, 'legacy-load').success)) {
            this._loadStatus = {ready: false, reason: 'validation'}; return;
        }
        this.dropOrphanBlocklistEntriesAtLoad(candidate);
        this._serverOption = candidate; this._loadStatus = {ready: true, source: 'loaded'};
    }

    /**
     * #286 터널이 없는 포트에 건 차단 항목은 나중에 그 포트로 만든 다른 터널에 걸리므로 시작할 때 경고와 함께 뺀다.
     * 터널 포트를 숫자로 정규화한 뒤(legacy-load)에 판정한다. 저장할 때는 빼지 않는다. 서버 설정 저장으로 터널을 빼도
     * 그 리스너는 다시 시작할 때까지 돌고 포트를 쥐고 있으므로, 그동안 항목을 남겨 계속 막는다.
     */
    private dropOrphanBlocklistEntriesAtLoad(candidate: ServerOption): void {
        const security = candidate.connectionSecurity;
        if(!security) return;
        const result = dropOrphanBlocklistEntries(security.blocklist ?? [], new Set(candidate.tunnelingOptions.map((tunnel) => tunnel.forwardPort)));
        result.warnings.forEach((warning) => logger.warn(warning));
        security.blocklist = result.entries;
    }

    /**
     * #182: 이전 버전(main)에는 터널 속도 제한과 세션 유휴 TTL 이 없었다. 그 설정 파일을 불러오면 두 값이 비어 있다.
     * 기본값으로 채우면 업그레이드만으로 정상 연결이 10분씩 차단되거나 유휴 세션이 끊기므로, 비어 있는 값은 예전 동작(끔)으로
     * 채운다. 속도 제한은 프로토콜 기본값을 담아 두어 관리 화면에서 켜기만 하면 된다. 이 버전이 저장한 파일은 두 값을 늘 담는다.
     * 이전 버전 파일은 controlProtocolMode 가 없는 것으로 가린다(이전 버전에는 없던 키이고, 이 버전은 늘 저장한다).
     * 이 버전 형식의 파일에서 값이 빠졌으면 지금 기본값을 따른다.
     */
    private preserveLegacyDefaults(candidate: ServerOption): void {
        if(candidate.controlProtocolMode !== undefined) return;
        const disabled: number[] = [];
        for(const tunnel of candidate.tunnelingOptions ?? []) {
            if(tunnel && typeof tunnel === 'object' && tunnel.rateLimit === undefined) {
                tunnel.rateLimit = {...defaultRateLimit(tunnel.protocol), enabled: false};
                disabled.push(tunnel.forwardPort);
            }
        }
        if(disabled.length > 0) {
            logger.warn(`rate limiting kept off for tunnels saved by an earlier version: ${disabled.join(', ')}. Turn it on per tunnel in the admin console.`);
        }
        // 이전 버전은 서버 버퍼 -1·0 을 "제한 없음"으로 저장했다. 지금은 1MiB 이상만 받으므로 그대로 두면 서버가 기동하지
        // 않는다. 512MB 서버에서 무제한 버퍼는 위험하므로 기본값(8MiB)으로 바꾸고 알린다. 세션이 열린 뒤에는 배압으로
        // 흐름을 조절하므로 정상 전송은 끊기지 않는다.
        const unlimited: number[] = [];
        for(const tunnel of candidate.tunnelingOptions ?? []) {
            if(tunnel && typeof tunnel === 'object' && typeof tunnel.bufferLimitOnServer === 'number' && tunnel.bufferLimitOnServer <= 0) {
                delete tunnel.bufferLimitOnServer;
                unlimited.push(tunnel.forwardPort);
            }
        }
        if(unlimited.length > 0) {
            logger.warn(`server buffer "unlimited" (-1 or 0) from an earlier version replaced by the default 8 MiB for tunnels: ${unlimited.join(', ')}.`);
        }
        if(candidate.sessionTtlMs === undefined) {
            candidate.sessionTtlMs = 0;
            logger.warn('session idle TTL kept off because the configuration was saved by an earlier version. Set sessionTtlMs to turn it on.');
        }
    }

    public verificationServerOption(option: ServerOption) : {success: boolean, message: string, serverOption?: ServerOption} {
        if(Array.isArray(option.tunnelingOptions)) {
            const normalizedTunnels = option.tunnelingOptions.map(tunnel =>
                tunnel && typeof tunnel === 'object' && !Array.isArray(tunnel) ? {...tunnel} : tunnel);
            for(const tunnel of normalizedTunnels) {
                if(tunnel && typeof tunnel === 'object' && !Array.isArray(tunnel)) {
                    const buffer = this.normalizeServerBufferLimit(tunnel);
                    if(!buffer.success) return buffer;
                    const rateLimit = normalizeRateLimit(tunnel.protocol, tunnel.rateLimit);
                    if(!rateLimit.success) return rateLimit;
                    tunnel.rateLimit = rateLimit.rateLimit;
                }
            }
            option.tunnelingOptions = normalizedTunnels;
        }
        const ttl = resolveSessionTtlMs(option.sessionTtlMs);
        if(!ttl.success) return ttl;
        option.sessionTtlMs = ttl.ttlMs;
        const retention = resolveAuditRetentionDays(option.auditRetentionDays);
        if(!retention.success) return retention;
        option.auditRetentionDays = retention.days;
        const queue = resolveAuditQueueSize(option.auditQueueSize);
        if(!queue.success) return queue;
        option.auditQueueSize = queue.size;
        const logLevel = resolveLogLevel(option.logLevel);
        if(!logLevel.success) return logLevel;
        option.logLevel = logLevel.level;
        const closeStall = resolveCloseStallMs(option.closeStallMs);
        if(!closeStall.success) return closeStall;
        option.closeStallMs = closeStall.ms;
        const closeGrace = resolveCloseGraceMs(option.closeGraceMs);
        if(!closeGrace.success) return closeGrace;
        option.closeGraceMs = closeGrace.ms;
        if(!option.key) {
            return {success: false, message: "key is undefined"};
        }
        if(!option.adminPort) {
            return {success: false, message: "adminPort is undefined"};
        }
        if(option.globalMemCacheLimit == undefined) {
            option.globalMemCacheLimit = 128;
        }
        if(option.globalMemCacheLimit < 0) {
            option.globalMemCacheLimit = 0;
        }
        if(option.adminPort < 0 || option.adminPort > 65535) {
            return {success: false, message: "adminPort is invalid (0 ~ 65535)"};
        }
        if(!option.port) {
            return {success: false, message: "port is undefined"};
        }
        if(!option.tunnelingOptions) {
            option.tunnelingOptions = [];
        }
        if(option.tls == undefined) {
            option.tls = false;
        }
        if(option.adminBindHost != undefined) {
            option.adminBindHost = option.adminBindHost.trim();
            if(option.adminBindHost.length == 0) {
                option.adminBindHost = undefined;
            }
        }
        option.adminTls = option.adminTls === true;
        option.mfaRequiredForSuperusers = option.mfaRequiredForSuperusers === true;
        option.controlProtocolMode = this.normalizeControlProtocolMode(option.controlProtocolMode);
        option.allowLegacyControlAuth = option.allowLegacyControlAuth === true;
        if(option.controlProtocolMode === "mtls-strict" && option.tls !== true) {
            return {success: false, message: "mtls-strict mode requires tls=true"};
        }
        if(!option.trustedClients) {
            option.trustedClients = [];
        }
        option.trustedClients = option.trustedClients.filter((trustedClient) => {
            return !!trustedClient.clientId && trustedClient.clientId.trim().length > 0
                && !!trustedClient.clientSecret && trustedClient.clientSecret.trim().length > 0;
        }).map((trustedClient) => ({
            clientId: trustedClient.clientId.trim(),
            clientSecret: trustedClient.clientSecret,
            displayName: trustedClient.displayName?.trim() || trustedClient.clientId.trim()
        }));
        const connectionSecurity = normalizeConnectionSecurity(option.connectionSecurity);
        if(!connectionSecurity.success) {
            return {success: false, message: connectionSecurity.message};
        }
        // #286 차단 목록의 틀린 항목은 실패가 아니라 경고다. 그 항목만 빼고 계속한다.
        connectionSecurity.blocklistWarnings.forEach((warning) => logger.warn(warning));
        option.connectionSecurity = connectionSecurity.value;
        return {success: true, message: "", serverOption: option};
    }

    private normalizeServerBufferLimit(option: TunnelingOption): {success: boolean; message: string} {
        const value = option.bufferLimitOnServer;
        if(value === undefined) {
            option.bufferLimitOnServer = 8;
        } else if(typeof value !== 'number' || !Number.isFinite(value) || value < 1 || !Number.isFinite(value * 1024 * 1024)) {
            return {success: false, message: 'Server buffer must be a finite number of at least 1 MiB.'};
        }
        return {success: true, message: ''};
    }

    public verificationTunnelingOption(
        option: TunnelingOption,
        normalizationMode: TunnelingOptionNormalizationMode = "new-config"
    ) : {success: boolean,forwardPort: number, message: string} {
        if(!option.forwardPort) {
            return {success: false,forwardPort: -1, message: "forwardPort is undefined"};
        }
        if(!option.protocol) {
            return {success: false,forwardPort:option.forwardPort,  message: "protocol is undefined"};
        }
        // 예전 서버는 본문 타입을 보지 않아 server.yaml 에 "8080" 같은 문자열 포트가 남았을 수 있다. 읽을 때만 정규 10진 문자열을
        // 숫자로 바꾼다. 거절하면 업그레이드 뒤 서버 전체가 기동하지 못한다.
        if(normalizationMode === "legacy-load" && typeof option.forwardPort === 'string' && /^[1-9]\d{0,4}$/.test(option.forwardPort)) {
            option.forwardPort = Number(option.forwardPort);
        }
        // 숫자 타입의 정수만 받는다. "20010.0" 같은 문자열은 설정 조회(==)와 런타임 키(Map)가 서로 달라진다(#170).
        if(!Number.isSafeInteger(option.forwardPort) || option.forwardPort < 1 || option.forwardPort > 65535) {
            return {success: false,forwardPort:option.forwardPort, message: "forwardPort must be an integer from 1 to 65535"};
        }
        const buffer = this.normalizeServerBufferLimit(option);
        if(!buffer.success) return {...buffer, forwardPort: option.forwardPort};
        const rateLimit = normalizeRateLimit(option.protocol, option.rateLimit);
        if(!rateLimit.success) return {success: false, forwardPort: option.forwardPort, message: rateLimit.message};
        option.rateLimit = rateLimit.rateLimit;
        if(option.bufferLimitOnClient == undefined) {
            option.bufferLimitOnClient = 8;
        }
        // noinspection SuspiciousTypeOfGuard
        if(option.keepAlive == undefined || typeof option.keepAlive !== 'number' || option.keepAlive < 0) {
            option.keepAlive = -1;
        }
        if(option.inactiveOnStartup == undefined) {
            option.inactiveOnStartup = false;
        }
        if(!option.allowedClientNames) {
            option.allowedClientNames = [];
        }
        if(!option.allowedClientIds) {
            option.allowedClientIds = [];
        }
        if(option.protocol == "http" && option.destinationPort == undefined) {
            option.destinationPort = 80;
        }
        else if(option.protocol == "https") {
            if(option.destinationPort == undefined) option.destinationPort = 443;
            option.tls = true;
        }
        // TLS 터널에서 명시적으로 true 일 때만 대상 서버의 인증서 검증을 건너뛴다. 평문 터널에는 뜻이 없으므로 false 로 둔다(#280).
        option.allowSelfSignedDestinationCert = option.tls === true && option.allowSelfSignedDestinationCert === true;
        if(option.destinationPort == undefined) {
            return {success: false,forwardPort:option.forwardPort, message: "destinationPort is undefined"};
        }
        if(option.destinationPort < 0 || option.destinationPort > 65535) {
            return {success: false,forwardPort:option.forwardPort, message: "destinationPort is invalid (0 ~ 65535)"};
        }
        if(!option.destinationAddress) {
            return {success: false,forwardPort:option.forwardPort, message: "destinationAddress is undefined"};
        }
        if(option.tls == undefined) {
            option.tls = false;
        }
        if(!option.httpOption) {
            option.httpOption = {};
        }
        this.normalizationOfHttpOption(option.httpOption, normalizationMode, option.forwardPort);
        return {success: true,forwardPort:option.forwardPort, message: ""};
    }

    private normalizationOfHttpOption(
        option: HttpOption,
        normalizationMode: TunnelingOptionNormalizationMode,
        forwardPort?: number
    ) : void {

        if(option.rewriteHostInTextBody == undefined) {
            option.rewriteHostInTextBody = false;
        }
        if(option.customRequestHeaders == undefined) {
            option.customRequestHeaders = [];
        }
        if(option.customResponseHeaders == undefined) {
            option.customResponseHeaders = [];
        }
        if(option.replaceAccessControlAllowOrigin == undefined) {
            option.replaceAccessControlAllowOrigin = normalizationMode == "legacy-load";
            if(normalizationMode == "legacy-load") {
                logger.warn(`forwardPort ${forwardPort ?? -1}: legacy CORS reflection default preserved because replaceAccessControlAllowOrigin is unset; set it explicitly to false to adopt the new policy`);
            }
        }
        if(option.bodyRewriteRules == undefined) {
            option.bodyRewriteRules = [];
        }
        option.bodyRewriteRules = option.bodyRewriteRules.filter((rule  ) => rule.from && rule.from.length > 0 )
        option.customRequestHeaders = option.customRequestHeaders.filter((header  ) =>  header.name && header.name.length > 0 && header.value && header.value.length > 0);
        option.customResponseHeaders = option.customResponseHeaders.filter((header  ) =>  header.name && header.name.length > 0 && header.value && header.value.length > 0);
    }

    private loadRevisionState(): RevisionState {
        try {
            const raw = Files.toStringSync(this._stateFile);
            if(!raw || raw.length == 0) {
                return createInitialRevisionState();
            }
            const loaded = JSON.parse(raw) as RevisionState;
            return {
                ...createInitialRevisionState(),
                ...loaded,
                pendingRestartScopes: [...(loaded.pendingRestartScopes ?? [])]
            };
        } catch {
            return createInitialRevisionState();
        }
    }

    private saveRevisionState(): void {
        Files.writeAtomicSync(this._stateFile, JSON.stringify(this._revisionState, null, 2));
        try {
            fs.chmodSync(this._stateFile.toString(), 0o600);
        } catch {}
    }


    private makeDefaultOption() : ServerOption {
        return {
            key: `srv-${createOpaqueToken(16)}`,
            adminPort: 9300,
            adminBindHost: "127.0.0.1",
            adminTls: true,
            port: 9126,
            tls : false,
            controlProtocolMode: "mixed",
            allowLegacyControlAuth: false,
            trustedClients: [],
            tunnelingOptions: [],
            sessionTtlMs: DEFAULT_SESSION_TTL_MS,
            keepAlive: TCPServer.DEFAULT_KEEP_ALIVE
        }
    }

    private normalizeControlProtocolMode(mode?: ControlProtocolMode): ControlProtocolMode {
        if(mode == "legacy" || mode == "mixed" || mode == "mtls-strict") {
            return mode;
        }
        return "mixed";
    }



}

export default ServerOptionStore;

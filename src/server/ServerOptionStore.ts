import Environment from "../Environment";
import File from "../util/File";
import {ControlProtocolMode, DEFAULT_KEY, DEFAULT_SESSION_TTL_MS, resolveSessionTtlMs, HttpOption, ServerOption, TunnelingOption} from "../types/TunnelingOption";
import YAML from "yaml";
import Files from "../util/Files";
import ObjectUtil from "../util/ObjectUtil";
import LoggerFactory from "../util/logger/LoggerFactory";
import {TCPServer} from "../util/TCPServer";
import fs from "fs";
import {createOpaqueToken} from "../commons/ProtocolV2";
import {redactSecrets} from "../util/SecretRedactor";
import {createInitialRevisionState, RevisionState} from "./RevisionState";

const logger = LoggerFactory.getLogger('server', 'ServerOptionStore');

interface ServerOptionUpdateCallback {
    (serverOption: ServerOption): void;
}

type TunnelingOptionNormalizationMode = "new-config" | "legacy-load";

const OPTION_FILE_NAME: string = 'server.yaml';
const OPTION_STATE_FILE_NAME: string = '.server.state.json';

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

    public composeServerOptionWithTunnelingOption(tunnelingOption: TunnelingOption): {success: boolean, message: string, serverOption?: ServerOption} {
        if(!this._loadStatus.ready) return {success: false, message: 'server configuration is not ready'};
        const normalizedOption = ObjectUtil.cloneDeep(tunnelingOption);
        const result = this.verificationTunnelingOption(normalizedOption);
        if(!result.success) {
            return {success: false, message: result.message};
        }
        const serverOption = this.serverOption;
        const index = serverOption.tunnelingOptions.findIndex((option) => option.forwardPort == tunnelingOption.forwardPort);
        if(index < 0) {
            serverOption.tunnelingOptions.push(normalizedOption);
        } else {
            serverOption.tunnelingOptions[index] = normalizedOption;
        }
        return {success: true, message: "", serverOption};
    }

    public composeServerOptionWithoutTunnelingOption(forwardPort: number): {success: boolean, message: string, serverOption?: ServerOption} {
        if(!this._loadStatus.ready) return {success: false, message: 'server configuration is not ready'};
        const serverOption = this.serverOption;
        const index = serverOption.tunnelingOptions.findIndex((option) => option.forwardPort == forwardPort);
        if(index < 0) {
            return {success: false, message: `forwardPort ${forwardPort} is not registered`};
        }
        serverOption.tunnelingOptions.splice(index, 1);
        return {success: true, message: "", serverOption};
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
        const files = [
            {file: this._configFile, data: YAML.stringify(result.serverOption), mode: 0o600},
            {file: this._stateFile, data: JSON.stringify(revisionState, null, 2), mode: 0o600},
        ];
        return {success: true, message: "", prepared: {serverOption: result.serverOption!, revisionState, files}};
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
        if(!this.verificationServerOption(candidate).success ||
            candidate.tunnelingOptions.some(option => !this.verificationTunnelingOption(option, 'legacy-load').success)) {
            this._loadStatus = {ready: false, reason: 'validation'}; return;
        }
        this._serverOption = candidate; this._loadStatus = {ready: true, source: 'loaded'};
    }

    public verificationServerOption(option: ServerOption) : {success: boolean, message: string, serverOption?: ServerOption} {
        const ttl = resolveSessionTtlMs(option.sessionTtlMs);
        if(!ttl.success) return ttl;
        option.sessionTtlMs = ttl.ttlMs;
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
        return {success: true, message: "", serverOption: option};
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
        if(option.forwardPort < 0 || option.forwardPort > 65535) {
            return {success: false,forwardPort:option.forwardPort, message: "forwardPort is invalid (0 ~ 65535)"};
        }
        if(option.bufferLimitOnServer == undefined) {
            option.bufferLimitOnServer = 8;
        }
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

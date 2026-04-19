import Environment from "../Environment";
import File from "../util/File";
import {ControlProtocolMode, DEFAULT_KEY, HttpOption, ServerOption, TunnelingOption} from "../types/TunnelingOption";
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

class ServerOptionStore {

    private static _instance : ServerOptionStore;
    private readonly _configFile : File;
    private readonly _stateFile : File;
    private _serverOption : ServerOption;
    private _revisionState: RevisionState;
    private _serverOptionUpdateCallback? : ServerOptionUpdateCallback;

    public get serverOption() : ServerOption {
        //delete result['tunnelingOptions'];
        return ObjectUtil.cloneDeep(this._serverOption);
    }

    public set onServerOptionUpdateCallback(callback: ServerOptionUpdateCallback | undefined)  {
        this._serverOptionUpdateCallback = callback;
    }

    public get revisionState(): RevisionState {
        return ObjectUtil.cloneDeep(this._revisionState);
    }

    public prepareServerOption(serverOption: ServerOption): {success: boolean, message: string, serverOption?: ServerOption} {
        if(!serverOption.tunnelingOptions) {
            serverOption.tunnelingOptions = this._serverOption.tunnelingOptions;
        }
        return this.verificationServerOption(serverOption);
    }

    public composeServerOptionWithTunnelingOption(tunnelingOption: TunnelingOption): {success: boolean, message: string, serverOption?: ServerOption} {
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
        const result = this.prepareServerOption(ObjectUtil.cloneDeep(serverOption));
        if(!result.success) {
            return {success: false, message: result.message};
        }
        const updatedValues = ObjectUtil.findUpdates(this._serverOption, result.serverOption!);
        logger.info(`commitPreparedServerOption - ${JSON.stringify(redactSecrets(updatedValues))}`);
        this._serverOption = result.serverOption!;
        this._revisionState.currentRevision += 1;
        this._revisionState.lastCommittedAt = Date.now();
        this._revisionState.pendingRestartScopes = [...(options.pendingRestartScopes ?? [])];
        if(options.markLastKnownGood !== false) {
            this._revisionState.lastKnownGoodRevision = this._revisionState.currentRevision;
            this._revisionState.lastKnownGoodAt = this._revisionState.lastCommittedAt;
            this._revisionState.pendingRestartScopes = [];
        }
        this._revisionState.lastRollback = undefined;
        this.save();
        return {success: true, message: "", revisionState: this.revisionState};
    }

    public markLastKnownGood(revision: number = this._revisionState.currentRevision, pendingRestartScopes: string[] = []): void {
        this._revisionState.lastKnownGoodRevision = revision;
        this._revisionState.lastKnownGoodAt = Date.now();
        this._revisionState.pendingRestartScopes = [...pendingRestartScopes];
        if(pendingRestartScopes.length == 0 && revision == this._revisionState.currentRevision) {
            this._revisionState.lastRollback = undefined;
        }
        this.saveRevisionState();
    }

    public recordRollback(reason: string, failedScopes: string[], attemptedRevision?: number): void {
        this._revisionState.lastRollback = {
            at: Date.now(),
            reason,
            failedScopes: [...failedScopes],
            attemptedRevision: attemptedRevision ?? (this._revisionState.currentRevision + 1),
            restoredRevision: this._revisionState.lastKnownGoodRevision
        };
        this.saveRevisionState();
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
        let result : Array<TunnelingOption> = [];
        for(let option of this._serverOption.tunnelingOptions) {
            result.push(ObjectUtil.cloneDeep(option));
        }
        return result;
    }


    public getTunnelingOption(forwardPort: number) : TunnelingOption | undefined {
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
        if(!this._configFile.isFile() || !this.load()) {
            logger.info(`make default option`);
            this.makeDefaultOption();
            this._revisionState = createInitialRevisionState();
            this.save();
        }
    }

    public save() : void {
        let yamlString : string = YAML.stringify(this._serverOption);
        Files.writeAtomicSync(this._configFile, yamlString);
        try {
            fs.chmodSync(this._configFile.toString(), 0o600);
        } catch {}
        this.saveRevisionState();
    }

    public reset() : void {
        logger.info(`reset`);
        if(this._configFile.isFile()) {
            this._configFile.delete();
        }
        if(this._stateFile.isFile()) {
            this._stateFile.delete();
        }
        this.makeDefaultOption();
        this._revisionState = createInitialRevisionState();
        this.save();
    }

    private load() : boolean {
        try {
            let yamlString = Files.toStringSync(this._configFile);
            if(yamlString) {
                this._serverOption = YAML.parse(yamlString);
            }
            let result = this.verificationServerOption(this._serverOption);
            if(!result.success) {
                logger.error(`validation fail - ${result.message}`);
                return false;
            }
            for(let tunnelingOption of this._serverOption.tunnelingOptions) {
                let tunnelOptionResult = this.verificationTunnelingOption(tunnelingOption, "legacy-load")
                if(!tunnelOptionResult.success) {
                    logger.error(`validation fail - ${tunnelOptionResult.message}`);
                    return false;
                }
            }
            if(!this._revisionState) {
                this._revisionState = createInitialRevisionState();
            }
            return result.success;
        } catch (e) {
            console.error(e);
        }
        return false;
    }

    public verificationServerOption(option: ServerOption) : {success: boolean, message: string, serverOption?: ServerOption} {
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


    private makeDefaultOption() : void {
        this._serverOption = {
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

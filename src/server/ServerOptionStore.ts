import Environment from "../Environment";
import File from "../util/File";
import {DEFAULT_KEY, HttpOption, ServerOption, TunnelingOption} from "../types/TunnelingOption";
import YAML from "yaml";
import Files from "../util/Files";
import ObjectUtil from "../util/ObjectUtil";
import LoggerFactory from "../util/logger/LoggerFactory";

const logger = LoggerFactory.getLogger('server', 'ServerOptionStore');

interface ServerOptionUpdateCallback {
    (serverOption: ServerOption): void;
}

const OPTION_FILE_NAME: string = 'server.yaml';

class ServerOptionStore {

    private static _instance : ServerOptionStore;
    private readonly _configFile : File;
    private _serverOption : ServerOption;
    private _serverOptionUpdateCallback? : ServerOptionUpdateCallback;

    public get serverOption() : ServerOption {
        //delete result['tunnelingOptions'];
        return ObjectUtil.cloneDeep(this._serverOption);
    }

    public set onServerOptionUpdateCallback(callback: ServerOptionUpdateCallback | undefined)  {
        this._serverOptionUpdateCallback = callback;
    }

    public updateServerOption(serverOption: ServerOption): boolean {
        if(!serverOption.tunnelingOptions) {
            serverOption.tunnelingOptions = this._serverOption.tunnelingOptions;
        }
        let result = this.verificationServerOption(serverOption);
        if(result.success) {
            process.nextTick(() => {
                this._serverOptionUpdateCallback?.(ObjectUtil.cloneDeep(result.serverOption!));
            });
            let updatedValues =  ObjectUtil.findUpdates(this._serverOption, serverOption);
            logger.info(`updateServerOption - ${JSON.stringify(updatedValues)}`);
            this._serverOption = result.serverOption!;
            this.save();
            return true;
        }
        return false;
    }

    public removeTunnelingOption(forwardPort: number) : boolean {
        let index = this._serverOption.tunnelingOptions.findIndex((option) => option.forwardPort == forwardPort);
        if(index >= 0) {
            this._serverOption.tunnelingOptions.splice(index, 1);
            this.save();
            return true;
        }
        return false;
    }

    public updateTunnelingOption(tunnelingOption: TunnelingOption): boolean {
        let result = this.verificationTunnelingOption(tunnelingOption);
        if(result.success) {
            let index = this._serverOption.tunnelingOptions.findIndex((option) => option.forwardPort == tunnelingOption.forwardPort);
            if(index < 0) {
                this._serverOption.tunnelingOptions.push(tunnelingOption);
            } else {
                this._serverOption.tunnelingOptions[index] = tunnelingOption;
            }
            this.save();
            return true;
        }
        return false;
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

    constructor() {
        let configDir : string = Environment.path.configDir;
        let configDirFile = new File(configDir);
        if(!configDirFile.isDirectory()) configDirFile.mkdirs();
        this._configFile = new File(configDir, OPTION_FILE_NAME);
        if(!this._configFile.isFile() || !this.load()) {
            logger.info(`make default option`);
            this.makeDefaultOption();
            this.save();
        }
    }

    public save() : void {
        let yamlString : string = YAML.stringify(this._serverOption);
        Files.writeSync(this._configFile, yamlString);
    }

    public reset() : void {
        logger.info(`reset`);
        if(this._configFile.isFile()) {
            this._configFile.delete();
        }
        this.makeDefaultOption();
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
                let tunnelOptionResult = this.verificationTunnelingOption(tunnelingOption)
                if(!tunnelOptionResult.success) {
                    logger.error(`validation fail - ${tunnelOptionResult.message}`);
                    return false;
                }
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
        option.adminTls = !option.adminTls ? false : option.adminTls;
        return {success: true, message: "", serverOption: option};
    }

    public verificationTunnelingOption(option: TunnelingOption) : {success: boolean,forwardPort: number, message: string} {
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
            option.bufferLimitOnServer = -1;
        }
        if(option.bufferLimitOnClient == undefined) {
            option.bufferLimitOnClient = -1;
        }

        if(option.inactiveOnStartup == undefined) {
            option.inactiveOnStartup = false;
        }
        if(!option.allowedClientNames) {
            option.allowedClientNames = [];
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
        this.normalizationOfHttpOption(option.httpOption);
        return {success: true,forwardPort:option.forwardPort, message: ""};
    }

    private normalizationOfHttpOption(option: HttpOption) : void {

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
            option.replaceAccessControlAllowOrigin = true;
        }
        if(option.bodyRewriteRules == undefined) {
            option.bodyRewriteRules = [];
        }
        option.bodyRewriteRules = option.bodyRewriteRules.filter((rule  ) => rule.from && rule.from.length > 0 )
        option.customRequestHeaders = option.customRequestHeaders.filter((header  ) =>  header.name && header.name.length > 0 && header.value && header.value.length > 0);
        option.customResponseHeaders = option.customResponseHeaders.filter((header  ) =>  header.name && header.name.length > 0 && header.value && header.value.length > 0);
    }


    private makeDefaultOption() : void {
        this._serverOption = {
            key: DEFAULT_KEY,
            adminPort: 9300,
            port: 9126,
            tls : false,
            tunnelingOptions: []
        }
    }



}

export default ServerOptionStore;
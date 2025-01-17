"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Environment_1 = __importDefault(require("../Environment"));
const File_1 = __importDefault(require("../util/File"));
const TunnelingOption_1 = require("../types/TunnelingOption");
const yaml_1 = __importDefault(require("yaml"));
const Files_1 = __importDefault(require("../util/Files"));
const ObjectUtil_1 = __importDefault(require("../util/ObjectUtil"));
const LoggerFactory_1 = __importDefault(require("../util/logger/LoggerFactory"));
const TCPServer_1 = require("../util/TCPServer");
const logger = LoggerFactory_1.default.getLogger('server', 'ServerOptionStore');
const OPTION_FILE_NAME = 'server.yaml';
class ServerOptionStore {
    static _instance;
    _configFile;
    _serverOption;
    _serverOptionUpdateCallback;
    get serverOption() {
        //delete result['tunnelingOptions'];
        return ObjectUtil_1.default.cloneDeep(this._serverOption);
    }
    set onServerOptionUpdateCallback(callback) {
        this._serverOptionUpdateCallback = callback;
    }
    updateServerOption(serverOption) {
        if (!serverOption.tunnelingOptions) {
            serverOption.tunnelingOptions = this._serverOption.tunnelingOptions;
        }
        let result = this.verificationServerOption(serverOption);
        if (result.success) {
            process.nextTick(() => {
                this._serverOptionUpdateCallback?.(ObjectUtil_1.default.cloneDeep(result.serverOption));
            });
            let updatedValues = ObjectUtil_1.default.findUpdates(this._serverOption, serverOption);
            logger.info(`updateServerOption - ${JSON.stringify(updatedValues)}`);
            this._serverOption = result.serverOption;
            this.save();
            return true;
        }
        return false;
    }
    removeTunnelingOption(forwardPort) {
        let index = this._serverOption.tunnelingOptions.findIndex((option) => option.forwardPort == forwardPort);
        if (index >= 0) {
            this._serverOption.tunnelingOptions.splice(index, 1);
            this.save();
            return true;
        }
        return false;
    }
    updateTunnelingOption(tunnelingOption) {
        let result = this.verificationTunnelingOption(tunnelingOption);
        if (result.success) {
            let index = this._serverOption.tunnelingOptions.findIndex((option) => option.forwardPort == tunnelingOption.forwardPort);
            if (index < 0) {
                this._serverOption.tunnelingOptions.push(tunnelingOption);
            }
            else {
                this._serverOption.tunnelingOptions[index] = tunnelingOption;
            }
            this.save();
            return true;
        }
        return false;
    }
    getTunnelingOptions() {
        let result = [];
        for (let option of this._serverOption.tunnelingOptions) {
            result.push(ObjectUtil_1.default.cloneDeep(option));
        }
        return result;
    }
    getTunnelingOption(forwardPort) {
        for (let option of this._serverOption.tunnelingOptions) {
            if (option.forwardPort == forwardPort) {
                return ObjectUtil_1.default.cloneDeep(option);
            }
        }
        return undefined;
    }
    static get instance() {
        if (!ServerOptionStore._instance) {
            ServerOptionStore._instance = new ServerOptionStore();
        }
        return ServerOptionStore._instance;
    }
    constructor() {
        let configDir = Environment_1.default.path.configDir;
        let configDirFile = new File_1.default(configDir);
        if (!configDirFile.isDirectory())
            configDirFile.mkdirs();
        this._configFile = new File_1.default(configDir, OPTION_FILE_NAME);
        if (!this._configFile.isFile() || !this.load()) {
            logger.info(`make default option`);
            this.makeDefaultOption();
            this.save();
        }
    }
    save() {
        let yamlString = yaml_1.default.stringify(this._serverOption);
        Files_1.default.writeSync(this._configFile, yamlString);
    }
    reset() {
        logger.info(`reset`);
        if (this._configFile.isFile()) {
            this._configFile.delete();
        }
        this.makeDefaultOption();
        this.save();
    }
    load() {
        try {
            let yamlString = Files_1.default.toStringSync(this._configFile);
            if (yamlString) {
                this._serverOption = yaml_1.default.parse(yamlString);
            }
            let result = this.verificationServerOption(this._serverOption);
            if (!result.success) {
                logger.error(`validation fail - ${result.message}`);
                return false;
            }
            for (let tunnelingOption of this._serverOption.tunnelingOptions) {
                let tunnelOptionResult = this.verificationTunnelingOption(tunnelingOption);
                if (!tunnelOptionResult.success) {
                    logger.error(`validation fail - ${tunnelOptionResult.message}`);
                    return false;
                }
            }
            return result.success;
        }
        catch (e) {
            console.error(e);
        }
        return false;
    }
    verificationServerOption(option) {
        if (!option.key) {
            return { success: false, message: "key is undefined" };
        }
        if (!option.adminPort) {
            return { success: false, message: "adminPort is undefined" };
        }
        if (option.globalMemCacheLimit == undefined) {
            option.globalMemCacheLimit = 128;
        }
        if (option.globalMemCacheLimit < 0) {
            option.globalMemCacheLimit = 0;
        }
        if (option.adminPort < 0 || option.adminPort > 65535) {
            return { success: false, message: "adminPort is invalid (0 ~ 65535)" };
        }
        if (!option.port) {
            return { success: false, message: "port is undefined" };
        }
        if (!option.tunnelingOptions) {
            option.tunnelingOptions = [];
        }
        if (option.tls == undefined) {
            option.tls = false;
        }
        option.adminTls = !option.adminTls ? false : option.adminTls;
        return { success: true, message: "", serverOption: option };
    }
    verificationTunnelingOption(option) {
        if (!option.forwardPort) {
            return { success: false, forwardPort: -1, message: "forwardPort is undefined" };
        }
        if (!option.protocol) {
            return { success: false, forwardPort: option.forwardPort, message: "protocol is undefined" };
        }
        if (option.forwardPort < 0 || option.forwardPort > 65535) {
            return { success: false, forwardPort: option.forwardPort, message: "forwardPort is invalid (0 ~ 65535)" };
        }
        if (option.bufferLimitOnServer == undefined) {
            option.bufferLimitOnServer = -1;
        }
        if (option.bufferLimitOnClient == undefined) {
            option.bufferLimitOnClient = -1;
        }
        // noinspection SuspiciousTypeOfGuard
        if (option.keepAlive == undefined || typeof option.keepAlive !== 'number' || option.keepAlive < 0) {
            option.keepAlive = -1;
        }
        if (option.inactiveOnStartup == undefined) {
            option.inactiveOnStartup = false;
        }
        if (!option.allowedClientNames) {
            option.allowedClientNames = [];
        }
        if (option.protocol == "http" && option.destinationPort == undefined) {
            option.destinationPort = 80;
        }
        else if (option.protocol == "https") {
            if (option.destinationPort == undefined)
                option.destinationPort = 443;
            option.tls = true;
        }
        if (option.destinationPort == undefined) {
            return { success: false, forwardPort: option.forwardPort, message: "destinationPort is undefined" };
        }
        if (option.destinationPort < 0 || option.destinationPort > 65535) {
            return { success: false, forwardPort: option.forwardPort, message: "destinationPort is invalid (0 ~ 65535)" };
        }
        if (!option.destinationAddress) {
            return { success: false, forwardPort: option.forwardPort, message: "destinationAddress is undefined" };
        }
        if (option.tls == undefined) {
            option.tls = false;
        }
        if (!option.httpOption) {
            option.httpOption = {};
        }
        this.normalizationOfHttpOption(option.httpOption);
        return { success: true, forwardPort: option.forwardPort, message: "" };
    }
    normalizationOfHttpOption(option) {
        if (option.rewriteHostInTextBody == undefined) {
            option.rewriteHostInTextBody = false;
        }
        if (option.customRequestHeaders == undefined) {
            option.customRequestHeaders = [];
        }
        if (option.customResponseHeaders == undefined) {
            option.customResponseHeaders = [];
        }
        if (option.replaceAccessControlAllowOrigin == undefined) {
            option.replaceAccessControlAllowOrigin = true;
        }
        if (option.bodyRewriteRules == undefined) {
            option.bodyRewriteRules = [];
        }
        option.bodyRewriteRules = option.bodyRewriteRules.filter((rule) => rule.from && rule.from.length > 0);
        option.customRequestHeaders = option.customRequestHeaders.filter((header) => header.name && header.name.length > 0 && header.value && header.value.length > 0);
        option.customResponseHeaders = option.customResponseHeaders.filter((header) => header.name && header.name.length > 0 && header.value && header.value.length > 0);
    }
    makeDefaultOption() {
        this._serverOption = {
            key: TunnelingOption_1.DEFAULT_KEY,
            adminPort: 9300,
            port: 9126,
            tls: false,
            tunnelingOptions: [],
            keepAlive: TCPServer_1.TCPServer.DEFAULT_KEEP_ALIVE
        };
    }
}
exports.default = ServerOptionStore;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const TunnelingOption_1 = require("../types/TunnelingOption");
const TunnelNames_1 = __importDefault(require("./TunnelNames"));
const TTTClient_1 = __importDefault(require("./TTTClient"));
const File_1 = __importDefault(require("../util/File"));
const Environment_1 = __importDefault(require("../Environment"));
const yaml_1 = __importDefault(require("yaml"));
const Files_1 = __importDefault(require("../util/Files"));
const CLI_1 = __importDefault(require("../util/CLI"));
const SocketHandler_1 = require("../util/SocketHandler");
const LoggerFactory_1 = __importDefault(require("../util/logger/LoggerFactory"));
const logger = LoggerFactory_1.default.getLogger('client', 'ClientApp');
const CLIENT_OPTION_FILE_NAME = "client.yaml";
let _printClientOptions = (clientOption) => {
    let options = '';
    let obj = clientOption;
    for (let key in obj) {
        options += `\t\t\t  -${key}: ${obj[key]} \n`;
    }
    logger.info(`Client options: \n${options}`);
};
let _loadClientOptionFromFile = () => {
    let file = new File_1.default(Environment_1.default.path.configDir, CLIENT_OPTION_FILE_NAME);
    if (file.canRead()) {
        let yamlString = Files_1.default.toStringSync(file);
        if (yamlString == undefined || yamlString.length == 0)
            return undefined;
        let clientOption = yaml_1.default.parse(yamlString);
        return clientOption;
    }
    return undefined;
};
let normalizationClientOption = (clientOption) => {
    if (clientOption.key == undefined) {
        clientOption.key = TunnelingOption_1.DEFAULT_KEY;
    }
    if (clientOption.host == undefined) {
        clientOption.host = "localhost";
    }
    if (clientOption.port == undefined) {
        clientOption.port = 9126;
    }
    if (clientOption.tls == undefined) {
        clientOption.tls = false;
    }
    if (clientOption.name == undefined) {
        clientOption.name = TunnelNames_1.default[Math.floor(Math.random() * TunnelNames_1.default.length)];
    }
    return clientOption;
};
let _loadClientOption = () => {
    let clientOption = {
        key: TunnelingOption_1.DEFAULT_KEY,
        host: "localhost",
        port: 9126,
        tls: false,
        name: TunnelNames_1.default[Math.floor(Math.random() * TunnelNames_1.default.length)],
        globalMemCacheLimit: 128,
        keepAlive: 0
    };
    let savedOption = _loadClientOptionFromFile();
    if (savedOption) {
        clientOption = normalizationClientOption(savedOption);
    }
    let argv = CLI_1.default.readSimpleOptions();
    if (argv["key"]) {
        clientOption.key = argv["key"];
    }
    if (argv["addr"]) {
        let addr = argv["addr"];
        let addrSplit = addr.split(":");
        if (addrSplit.length == 2) {
            clientOption.host = addrSplit[0];
            clientOption.port = parseInt(addrSplit[1]);
            if (isNaN(clientOption.port)) {
                throw new Error("port is not number.");
            }
            else if (clientOption.port <= 0 || clientOption.port > 65535) {
                throw new Error("port is out of range. (1 ~ 65535)");
            }
        }
        else {
            clientOption.host = addr;
        }
    }
    if (argv["keepAlive"]) {
        clientOption.keepAlive = Math.floor(parseInt(argv["keepAlive"]));
        if (isNaN(clientOption.keepAlive)) {
            console.warn(`keepAlive '${argv["keepAlive"]}' is not number.`);
            clientOption.keepAlive = -1;
        }
        else if (clientOption.keepAlive < 0) {
            console.warn(`keepAlive is disabled. (keepAlive: ${clientOption.keepAlive})`);
            clientOption.keepAlive = -1;
        }
    }
    if (argv["tls"] != undefined && (argv["tls"] == "" || argv["tls"].toLowerCase() != "false")) {
        clientOption.tls = true;
    }
    if (argv["name"]) {
        clientOption.name = argv["name"];
    }
    if (argv["bufferLimit"]) {
        clientOption.globalMemCacheLimit = Math.floor(parseInt(argv["bufferLimit"]));
        if (isNaN(clientOption.globalMemCacheLimit)) {
            console.warn(`bufferLimit '${argv["bufferLimit"]}' is not number.`);
            clientOption.globalMemCacheLimit = 238;
        }
        else if (clientOption.globalMemCacheLimit < -1) {
            console.warn(`bufferLimit '${argv["bufferLimit"]}' is less than -1.`);
            clientOption.globalMemCacheLimit = -1;
        }
        else if (clientOption.globalMemCacheLimit > 1048576) {
            clientOption.globalMemCacheLimit = 1048576;
        }
    }
    if (argv["save"] != undefined && (argv["save"] == "" || argv["save"].toLowerCase() != "false")) {
        let file = new File_1.default(Environment_1.default.path.configDir, CLIENT_OPTION_FILE_NAME);
        let yamlString = yaml_1.default.stringify(clientOption);
        Files_1.default.writeSync(file, yamlString);
    }
    _printClientOptions(clientOption);
    SocketHandler_1.SocketHandler.GlobalMemCacheLimit = clientOption.globalMemCacheLimit * 1024 * 1024;
    return clientOption;
};
let ClientApp = {
    start() {
        SocketHandler_1.SocketHandler.GlobalMemCacheLimit = 128 * 1024 * 1024;
        let tttClient = TTTClient_1.default.create(_loadClientOption());
        tttClient.start();
    }
};
exports.default = ClientApp;

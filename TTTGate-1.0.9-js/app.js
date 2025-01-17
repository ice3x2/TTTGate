"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ClientApp_1 = __importDefault(require("./client/ClientApp"));
const ServerApp_1 = __importDefault(require("./server/ServerApp"));
const Environment_1 = __importDefault(require("./Environment"));
const SocketHandler_1 = require("./util/SocketHandler");
const Sentinel_1 = __importDefault(require("./Sentinel"));
const LoggerFactory_1 = __importDefault(require("./util/logger/LoggerFactory"));
let config = LoggerFactory_1.default.cloneConfig();
config.logFileDir = Environment_1.default.path.logDir;
config.appendWriteConfig({ name: 'server', console: true, history: 2 });
config.appendWriteConfig({ name: 'client', console: true });
config.appendWriteConfig({ name: 'boot', console: true });
LoggerFactory_1.default.updateConfig(config);
let app = () => {
    console.log('TTTGate v' + Environment_1.default.version.name + ' (' + Environment_1.default.version.build + ')');
    let sentinel = Sentinel_1.default.create(Environment_1.default.devMode);
    let _findTypeByArgv = () => {
        let items = process.argv;
        for (let item of items) {
            if (item.startsWith("-")) {
                return 'none';
            }
            else if (item == 'server')
                return 'server';
            else if (item == 'stop')
                return 'stop';
            else if (item == 'client')
                return 'client';
        }
        return 'none';
    };
    let startType = _findTypeByArgv();
    if (startType == 'stop') {
        console.log('Stop TTTGate processes ...');
        Sentinel_1.default.stop();
        return;
    }
    else if (Sentinel_1.default.isSentinelMode() || (!Sentinel_1.default.hasExecuteMode() && Sentinel_1.default.isDaemonMode())) {
        sentinel.start();
        return;
    }
    else if (startType == 'server' && !sentinel.start()) {
        SocketHandler_1.SocketHandler.fileCacheDirPath = Environment_1.default.path.serverCacheDir;
        ServerApp_1.default.start().then(() => {
            console.log('server started');
        }).catch((err) => {
            console.error(err);
        });
    }
    else if (startType == 'client' && !sentinel.start()) {
        SocketHandler_1.SocketHandler.fileCacheDirPath = Environment_1.default.path.clientCacheDir;
        ClientApp_1.default.start();
    }
    else if (!Sentinel_1.default.isDaemonMode() && !Sentinel_1.default.hasExecuteMode()) {
        console.log('Usage: TTTGate [server|client] [options]');
        console.log('');
        console.log('    server: start server');
        console.log('       -adminPort [port]  : Admin server port');
        console.log('       -reset             : Reset server options');
        console.log('       -daemon            : Background execution and process monitoring.');
        console.log('');
        console.log('    client: start client');
        console.log('       -addr [host:port]  : server address. (ex: host.com:1234)');
        console.log('                           The port number is optional.         ');
        console.log('       -tls               : use tls');
        console.log('       -name [name]       : client name');
        console.log('       -key  [key]        : authentication key');
        console.log('       -bufferLimit [MiB] : Buffer limit size on memory.');
        console.log('       -save              : Save options to file');
        console.log('       -daemon            : Background execution and process monitoring.');
        console.log('');
        console.log('    stop: stop server or client');
    }
};
app();

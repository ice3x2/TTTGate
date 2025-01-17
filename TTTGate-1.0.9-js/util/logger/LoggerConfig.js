"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoggerConfig = void 0;
const path_1 = __importDefault(require("path"));
class LoggerConfig {
    _defaultPath = path_1.default.join(__dirname, 'log');
    _writerConfigMap = new Map();
    _defaultWriteConfig = {
        console: true,
        default: true,
        file: false,
        name: '',
        level: 'debug',
        path: this._defaultPath
    };
    cloneWriteConfig(writeConfig) {
        return {
            path: writeConfig.path,
            name: writeConfig.name,
            history: writeConfig.history,
            console: writeConfig.console,
            file: writeConfig.file,
            default: writeConfig.default,
            level: writeConfig.level,
            pattern: writeConfig.pattern
        };
    }
    clone() {
        let config = LoggerConfig.create(this._defaultPath);
        this._writerConfigMap.forEach((writeConfig) => {
            config.appendWriteConfig(this.cloneWriteConfig(writeConfig));
        });
        config._defaultWriteConfig = this.cloneWriteConfig(this._defaultWriteConfig);
        return config;
    }
    set logFileDir(path) {
        this._defaultPath = path;
        this._defaultWriteConfig.path = this._defaultPath;
        this._writerConfigMap.forEach((writeConfig) => {
            writeConfig.path = writeConfig.path ?? this._defaultPath;
        });
    }
    static create(path) {
        let config = new LoggerConfig();
        config._defaultPath = path;
        return config;
    }
    constructor() {
    }
    appendWriteConfig(writeConfig) {
        writeConfig.path = writeConfig.path ?? this._defaultPath;
        writeConfig.history = writeConfig.history ?? 30;
        writeConfig.console = writeConfig.console ?? true;
        writeConfig.file = writeConfig.file ?? true;
        writeConfig.pattern = writeConfig.pattern ?? '%d{yyyy-MM-dd hh:mm:ss.SSS} [%p] %c - %m%n';
        writeConfig.level = writeConfig.level ?? 'info';
        if (writeConfig.default == undefined) {
            let alreadyDefault = Array.from(this._writerConfigMap.values()).find((config) => config.default = true);
            writeConfig.default = alreadyDefault == undefined;
        }
        else if (writeConfig.default) {
            this._writerConfigMap.forEach((config) => {
                config.default = false;
            });
            writeConfig.default = true;
        }
        this._writerConfigMap.set(writeConfig.name, writeConfig);
    }
    get defaultWriteConfig() {
        return this.cloneWriteConfig(this._defaultWriteConfig);
    }
    get writeConfigs() {
        return Array.from(this._writerConfigMap.values()).map((writeConfig) => {
            return this.cloneWriteConfig(writeConfig);
        });
    }
    removeWriteConfig(name) {
        return this._writerConfigMap.delete(name);
    }
    writeConfig(name) {
        return this._writerConfigMap.get(name);
    }
}
exports.LoggerConfig = LoggerConfig;

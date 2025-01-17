"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Logger_1 = __importDefault(require("./Logger"));
const LoggerConfig_1 = require("./LoggerConfig");
const path_1 = __importDefault(require("path"));
const LogWriter_1 = require("./LogWriter");
class LoggerFactory {
    static _loggerConfig = LoggerConfig_1.LoggerConfig.create(path_1.default.join(__dirname, 'logs'));
    static _logWriterMap = new Map();
    static _defaultLoggerWriter;
    static _loggerCache = new Map();
    static _isStarted = false;
    static cloneConfig() {
        return LoggerFactory._loggerConfig.clone();
    }
    static endLogWriter() {
        this._logWriterMap.forEach((logWriter) => {
            logWriter.end();
        });
        this._logWriterMap.clear();
    }
    static updateConfig(config) {
        this.endLogWriter();
        this._loggerConfig = config;
        this.newLogWriters(config);
    }
    static newLogWriters(writeConfig) {
        writeConfig.writeConfigs.forEach((conf) => {
            this._logWriterMap.set(conf.name, LogWriter_1.LogWriter.create(conf));
        });
        let defaultConfig = writeConfig.defaultWriteConfig;
        let defaultLogWriter = this._logWriterMap.get(defaultConfig.name);
        if (!defaultLogWriter) {
            defaultLogWriter = LogWriter_1.LogWriter.create(defaultConfig);
            this._logWriterMap.set(defaultConfig.name, defaultLogWriter);
        }
        this._defaultLoggerWriter = defaultLogWriter;
    }
    static getLogger(name, module) {
        let key = `${name}:${module ?? ''}`;
        let logger = this._loggerCache.get(key);
        if (!logger) {
            logger = this.createLogger(name, module);
            this._loggerCache.set(key, logger);
        }
        return logger;
    }
    static onMessage = (message) => {
        let writer = this._logWriterMap.get(message.name);
        if (!writer) {
            writer = this._defaultLoggerWriter;
        }
        writer.pushMessage(message);
    };
    static createLogger(name, module) {
        if (!this._isStarted) {
            this.updateConfig(this._loggerConfig);
            this._isStarted = true;
        }
        let logger = Logger_1.default.create(name, module ?? '', this.onMessage);
        return logger;
    }
}
exports.default = LoggerFactory;

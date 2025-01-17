import Logger from "./Logger";
import { LoggerConfig } from "./LoggerConfig";
declare class LoggerFactory {
    private static _loggerConfig;
    private static _logWriterMap;
    private static _defaultLoggerWriter;
    private static _loggerCache;
    private static _isStarted;
    static cloneConfig(): LoggerConfig;
    private static endLogWriter;
    static updateConfig(config: LoggerConfig): void;
    private static newLogWriters;
    static getLogger(name: string, module?: string): Logger;
    private static onMessage;
    static createLogger(name: string, module?: string): Logger;
}
export default LoggerFactory;

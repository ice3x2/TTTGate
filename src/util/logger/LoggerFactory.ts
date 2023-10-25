import Logger from "./Logger";
import {LoggerConfig} from "./LoggerConfig";
import Path from "path";
import { LogWriter } from "./LogWriter";


class LoggerFactory {

    private static _loggerConfig = LoggerConfig.create(Path.join(__dirname, 'logs'));
    private static _logWriterMap: Map<string, LogWriter> = new Map<string, LogWriter>();
    private static _loggerCache: Map<string, Logger> = new Map<string, Logger>();
    private static _isStarted: boolean = false;


    public static cloneConfig() : LoggerConfig {
        return LoggerFactory._loggerConfig.clone();
    }

    private static endLogWriter() {
        this._logWriterMap.forEach((logWriter) => {
            logWriter.end();
        });
        this._logWriterMap.clear();
    }

    public static updateConfig(config: LoggerConfig) {
        this.endLogWriter();
        this._loggerConfig = config;

    }

    private static newLogWriters(writeConfig: LoggerConfig) : void {
          writeConfig.defaultWriteConfig;

    }

    public static getLogger(name: string, module?: string) : Logger {
        let logger =this._loggerCache.get(`${name}:${module ?? ''}`);
        if(!logger) {

        }



    }


    public static createLogger(name: string, module?: string) : Logger {


        let logger = Logger.create(name, module ?? '', (message) => {


        });
        return logger;

    }



}

export default LoggerFactory;
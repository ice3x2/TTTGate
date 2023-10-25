import Logger from "./Logger";
import {LoggerConfig} from "./LoggerConfig";
import Path from "path";
import {LogMessage, LogWriter} from "./LogWriter";


class LoggerFactory {

    private static _loggerConfig = LoggerConfig.create(Path.join(__dirname, 'logs'));
    private static _logWriterMap: Map<string, LogWriter> = new Map<string, LogWriter>();
    private static _defaultLoggerWriter : LogWriter;
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
        this.newLogWriters(config);

    }

    private static newLogWriters(writeConfig: LoggerConfig) : void {
          writeConfig.writeConfigs.forEach((conf) => {
              this._logWriterMap.set(conf.name, LogWriter.create(conf));
          });
          let defaultConfig = writeConfig.defaultWriteConfig;
          let defaultLogWriter = this._logWriterMap.get(defaultConfig.name);
          if(!defaultLogWriter) {
              defaultLogWriter = LogWriter.create(defaultConfig);
              this._logWriterMap.set(defaultConfig.name, defaultLogWriter);
          }
          this._defaultLoggerWriter = defaultLogWriter;

    }

    public static getLogger(name: string, module?: string) : Logger {
        let key = `${name}:${module ?? ''}`;
        let logger =this._loggerCache.get(key);
        if(!logger) {
            logger = this.createLogger(name, module);
            this._loggerCache.set(key, logger);
        }
        return logger;
    }

    private static onMessage = (message: LogMessage) => {
         let writer = this._logWriterMap.get(message.name);
         if(!writer) {
             writer = this._defaultLoggerWriter;
         }
         writer.pushMessage(message);
    }


    public static createLogger(name: string, module?: string) : Logger {
        if(!this._isStarted) {
            this.updateConfig(this._loggerConfig);
            this._isStarted = true;
        }
        let logger = Logger.create(name, module ?? '',this.onMessage);
        return logger;

    }



}

export default LoggerFactory;
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

    /**
     * 쌓인 로그를 모두 파일에 쓴다(#207). 끝나면 같은 설정으로 새 writer 를 만들어 로거를 계속 쓸 수 있게 한다.
     * 설정 오류로 process.exit 하기 직전에 부른다.
     */
    public static async flush(): Promise<void> {
        const writers = [...new Set(this._logWriterMap.values())];
        this._logWriterMap.clear();
        // 새 writer 로 먼저 바꾼다. 끝내는 동안 들어온 로그는 새 writer 가 받는다(첫 기록 때 파일을 열므로 부작용이 없다).
        this.newLogWriters(this._loggerConfig);
        await Promise.all(writers.map(writer => writer.endAsync()));
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
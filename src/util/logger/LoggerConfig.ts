import Path from "path";


type Level = 'debug' | 'info' | 'warn' | 'error';

interface WriteConfig {
    path?: string;
    name: string;
    history?: number;
    console: boolean;
    file?: boolean;
    default?: boolean;
    level?: Level;
    pattern?: string;
}

class LoggerConfig {

    private _defaultPath : string = Path.join(__dirname,'log');
    private _writerConfigMap : Map<string, WriteConfig> = new Map<string, WriteConfig>();
    private _defaultWriteConfig : WriteConfig = {
        console: true,
        default: true,
        file: false,
        name: '',
        level: 'debug',
        path: this._defaultPath
    }

    private cloneWriteConfig(writeConfig: WriteConfig) : WriteConfig {
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

    public clone() : LoggerConfig {
        let config = LoggerConfig.create(this._defaultPath);
        this._writerConfigMap.forEach((writeConfig) => {
            config.appendWriteConfig(this.cloneWriteConfig(writeConfig));
        });
        config._defaultWriteConfig = this.cloneWriteConfig(this._defaultWriteConfig);
        return config;
    }


    public set logFileDir(path: string) {
        this._defaultPath = path;
        this._defaultWriteConfig.path = this._defaultPath;
        this._writerConfigMap.forEach((writeConfig) => {
                writeConfig.path = writeConfig.path ?? this._defaultPath;
         });
    }


    public static create(path: string) : LoggerConfig {
        let config = new LoggerConfig();
        config._defaultPath = path;
        return config;
    }

    private constructor() {
    }

    public appendWriteConfig(writeConfig: WriteConfig) {
        writeConfig.path = writeConfig.path ?? this._defaultPath;
        writeConfig.history = writeConfig.history ?? 30;
        writeConfig.console = writeConfig.console ?? true;
        writeConfig.file = writeConfig.file ?? true;
        writeConfig.pattern = writeConfig.pattern ?? '%d{yyyy-MM-dd hh:mm:ss.SSS} [%p] %c - %m%n';
        writeConfig.level = writeConfig.level ?? 'info';
        if(writeConfig.default == undefined) {
            let alreadyDefault = Array.from(this._writerConfigMap.values()).find((config) => config.default = true);
            writeConfig.default = alreadyDefault == undefined;
        } else if(writeConfig.default) {
            this._writerConfigMap.forEach((config) => {
                config.default = false;
            });
            writeConfig.default = true;
        }
        this._writerConfigMap.set(writeConfig.name, writeConfig);
    }

    public get defaultWriteConfig() : WriteConfig {
        return this.cloneWriteConfig(this._defaultWriteConfig);
    }

    public get writeConfigs() : Array<WriteConfig> {
        return Array.from(this._writerConfigMap.values()).map((writeConfig) => {
            return this.cloneWriteConfig(writeConfig);
        });
    }




    public removeWriteConfig(name: string) : boolean {
        return this._writerConfigMap.delete(name);
    }


    public writeConfig(name: string) : WriteConfig | undefined {
        return this._writerConfigMap.get(name);
    }


}

export  { Level, WriteConfig, LoggerConfig}
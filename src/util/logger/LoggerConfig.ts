

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

    private _defaultPath : string;
    private _writerConfigMap : Map<string, WriteConfig> = new Map<string, WriteConfig>();
    private _defaultWriteConfig : WriteConfig = {
        console: true,
        default: true,
        file: false,
        name: 'default',
        level: 'debug'
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

    public defaultWriteConfig() : WriteConfig | undefined {
        return this._defaultWriteConfig;
    }

    public removeWriteConfig(name: string) : boolean {
        return this._writerConfigMap.delete(name);
    }


    public writeConfig(name: string) : WriteConfig | undefined {
        return this._writerConfigMap.get(name);
    }


}

export  { Level, WriteConfig, LoggerConfig}
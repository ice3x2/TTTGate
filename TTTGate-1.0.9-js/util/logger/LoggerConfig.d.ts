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
declare class LoggerConfig {
    private _defaultPath;
    private _writerConfigMap;
    private _defaultWriteConfig;
    private cloneWriteConfig;
    clone(): LoggerConfig;
    set logFileDir(path: string);
    static create(path: string): LoggerConfig;
    private constructor();
    appendWriteConfig(writeConfig: WriteConfig): void;
    get defaultWriteConfig(): WriteConfig;
    get writeConfigs(): Array<WriteConfig>;
    removeWriteConfig(name: string): boolean;
    writeConfig(name: string): WriteConfig | undefined;
}
export { Level, WriteConfig, LoggerConfig };

import { Level, WriteConfig } from "./LoggerConfig";
interface LogMessage {
    name: string;
    module: string;
    message: string;
    day: number;
    level: Level;
    error?: any;
}
declare class LogWriter {
    private readonly _name;
    private _filePath;
    private readonly _dirPath;
    private _logMessageQueue;
    private _logFileStream;
    private readonly _history;
    private readonly _fileWrite;
    private readonly _consoleWrite;
    private _todayDate;
    private _waitEnd;
    private _isEnd;
    static create(writeConfig: WriteConfig): LogWriter;
    private constructor();
    private init;
    private sweepOldFiles;
    private daysSince;
    private logFileNameToDate;
    private logFilesInDir;
    private makeLogFilePath;
    pushMessage(message: LogMessage): void;
    private makeLogLine;
    private nextLogFile;
    private printLogMessage;
    end(): void;
    private close;
}
export { LogWriter, LogMessage };

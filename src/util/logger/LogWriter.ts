import {tls} from "node-forge";
import {Level, WriteConfig} from "./LoggerConfig"
import fs from "fs";
import Path from "path";

interface LogMessage {
    name: string;
    module: string;
    message: string;
    time: number;
    level: Level;
    error?: Error;
}

class LogWriter {

    private readonly _name : string;
    private  _filePath : string;
    private readonly _dirPath : string;
    private _logMessageQueue : Array<LogMessage> = [];
    private _logFileStream : fs.WriteStream | undefined;
    private readonly _history : number;
    private readonly _fileWrite : boolean;
    private readonly _consoleWrite : boolean;
    private _todayDate : number = 0;



    public static create(writeConfig: WriteConfig) : LogWriter {
        return new LogWriter(writeConfig);
    }

    private constructor(writeConfig: WriteConfig) {
        this._name = writeConfig.name;
        this._dirPath = writeConfig.path!;
        this._history = writeConfig.history ?? 30;
        this._fileWrite = writeConfig.file ?? true;
        this._consoleWrite = writeConfig.console ?? true;
    }

    private init() {
        this._todayDate = new Date().getDate();
        this._filePath = this.makeLogFilePath();

    }

    private sweepOldFiles() {
        this._todayDate = new Date().getDate();


    }

    private logFilesInDir() : Array<string> {
        let stat = fs.statSync(this._dirPath);
        if(!stat.isDirectory())
            throw new Error('Log directory is not directory.');
        let files = fs.readdirSync(this._dirPath);
        return files.filter((file) => {
            let regexString = `^${this._name}-\\d{4}\\.\\d{2}\\.\\d{2}\\.log$`;
            let regex = new RegExp(regexString);
            return regex.test(file);
        });

    }

    private makeLogFilePath() : string {
        let date = new Date();
        let year = date.getFullYear();
        let month = date.getMonth() + 1;
        let dayOfMonth = date.getDate();
        return Path.join(this._dirPath, `${this._name}"-"${year}.${month < 10 ? '0' + month : month}.${dayOfMonth < 10 ? '0' + dayOfMonth : dayOfMonth}.log`);
    }


    public static daysSinceStartOfYear(): number {
        const today: Date = new Date();
        const startOfYear: Date = new Date(today.getFullYear(), 0, 1);
        const millisecondsInDay: number = 24 * 60 * 60 * 1000; // 24 hours * 60 minutes * 60 seconds * 1000 milliseconds
        const diff: number = today.getTime() - startOfYear.getTime();
        const daysPassed: number = Math.floor(diff / millisecondsInDay);
        return daysPassed;
    }

    private pushMessage(message: LogMessage) {
        this._logMessageQueue.push(message);

    }






}


console.log(LogWriter.daysSinceStartOfYear());

export { LogWriter, LogMessage};
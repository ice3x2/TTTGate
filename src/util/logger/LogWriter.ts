import {Level, WriteConfig} from "./LoggerConfig"
import fs, {WriteStream} from "fs";
import Path from "path";

interface LogMessage {
    name: string;
    module: string;
    message: string;
    day: number;
    level: Level;
    error?: any;
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
    private _waitEnd : boolean = false;
    private _isEnd : boolean = false;


    public static create(writeConfig: WriteConfig) : LogWriter {
        return new LogWriter(writeConfig);
    }

    private constructor(writeConfig: WriteConfig) {
        this._name = writeConfig.name;
        this._dirPath = writeConfig.path!;
        this._history = writeConfig.history ?? 30;
        this._fileWrite = writeConfig.file ?? true;
        this._consoleWrite = writeConfig.console ?? true;
        this.init();
    }

    private init() {
        this._todayDate = new Date().getDate();

        if(this._fileWrite) {
            this._filePath = this.makeLogFilePath();
            this.sweepOldFiles();
            this._logFileStream = fs.createWriteStream(this._filePath, {flags: 'a'});
        }

    }

    private sweepOldFiles() {
        if(!this._fileWrite) {
            return;
        }
        this._todayDate = new Date().getDate();
        let logFiles = this.logFilesInDir();
        for(let i =0 ; i < logFiles.length; ++i) {
            let logFile = logFiles[i];
            let date = this.logFileNameToDate(logFile);
            let diff = this.daysSince(new Date()) - this.daysSince(date);
            if(diff > this._history && this._history > 0) {
                fs.unlinkSync(Path.join(this._dirPath, logFile));
            }
        }
    }

    private daysSince(startDate: Date): number {
        const today: Date = new Date();
        const millisecondsInDay: number = 24 * 60 * 60 * 1000; // 24 hours * 60 minutes * 60 seconds * 1000 milliseconds
        const diff: number = today.getTime() - startDate.getTime();
        const daysPassed: number = Math.floor(diff / millisecondsInDay);
        return daysPassed;
    }

    private logFileNameToDate(fileName: string) : Date {
        let regexString = `^${this._name}-(\\d{4})\\.(\\d{2})\\.(\\d{2})\\.log$`;
        let regex = new RegExp(regexString);
        let result = regex.exec(fileName);
        if(result == null)
            return new Date();
        let year = parseInt(result[1]);
        let month = parseInt(result[2]) - 1;
        let dayOfMonth = parseInt(result[3]);
        return new Date(year, month, dayOfMonth);

    }

    private logFilesInDir() : Array<string> {
        try {
            fs.existsSync(this._dirPath) || fs.mkdirSync(this._dirPath);
            let stat = fs.statSync(this._dirPath);
            if (!stat.isDirectory())
                throw new Error('Log directory is not directory.');
            let files = fs.readdirSync(this._dirPath);
            return files.filter((file) => {
                let regexString = `^${this._name}-\\d{4}\\.\\d{2}\\.\\d{2}\\.log$`;
                let regex = new RegExp(regexString);
                return regex.test(file);
            });
        } catch (e) {
            return [];
        }

    }

    private makeLogFilePath() : string {
        let date = new Date();
        let year = date.getFullYear();
        let month = date.getMonth() + 1;
        let dayOfMonth = date.getDate();
        return Path.join(this._dirPath, `${this._name}-${year}.${month < 10 ? '0' + month : month}.${dayOfMonth < 10 ? '0' + dayOfMonth : dayOfMonth}.log`);
    }



     public pushMessage(message: LogMessage) {
        message.day = Date.now();
        if(this._fileWrite) {
            this._logMessageQueue.push(message);
            if (this._logMessageQueue.length == 1) {
                this.printLogMessage();
            }
        } else if(this._consoleWrite) {
            console.log(this.makeLogLine(message));
        }
    }

    private makeLogLine(message: LogMessage) : string {
        let dateString = new Date(message.day).toISOString();
        let levelString = message.level.toUpperCase();
        let moduleString = message.module;
        let messageString = message.message;
        let errorString = message.error ? message.error.stack : '';
        return `${dateString} [${levelString}] ${moduleString && moduleString != '' ? moduleString + '::' : '' } ${messageString}\n${errorString && errorString != '' ? errorString + '\n' : ''}`;
    }

    private nextLogFile()  {
        this._todayDate = new Date().getDate();
        this._filePath = this.makeLogFilePath();
        this._logFileStream?.end();
        this._logFileStream = fs.createWriteStream(this._filePath,  {flags:'a'});
        this.sweepOldFiles();
    }

    private printLogMessage() {
        let message = this._logMessageQueue.shift();
        if(!message) {
            if(this._waitEnd && !this._isEnd) {
                this.close();
            }
            return;
        }
        if(message.day != this._todayDate) {
            this.nextLogFile();
        }
        let logLine = this.makeLogLine(message);
        if(this._fileWrite) {
            this._logFileStream?.write(logLine, (err) => {
                if(err) {
                    console.log(err);
                } else {
                    process.nextTick(() => {
                        this.printLogMessage();
                    });
                }
            });
        }
        if(this._consoleWrite) {
            console.log(logLine);
        }
    }



    public end() {
        if(this._waitEnd || this._isEnd) {
            return;
        }
        this._waitEnd = true;
        if(this._logMessageQueue.length == 0) {
            this.close();
        }

    }

    private close() {
        this._logMessageQueue = [];
        this._logFileStream?.end();
        this._isEnd = true;

    }




}


export { LogWriter, LogMessage};
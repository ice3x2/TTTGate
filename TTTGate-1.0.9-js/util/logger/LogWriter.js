"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogWriter = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class LogWriter {
    _name;
    _filePath;
    _dirPath;
    _logMessageQueue = [];
    _logFileStream;
    _history;
    _fileWrite;
    _consoleWrite;
    _todayDate = 0;
    _waitEnd = false;
    _isEnd = false;
    static create(writeConfig) {
        return new LogWriter(writeConfig);
    }
    constructor(writeConfig) {
        this._name = writeConfig.name;
        this._dirPath = writeConfig.path;
        this._history = writeConfig.history ?? 30;
        this._fileWrite = writeConfig.file ?? true;
        this._consoleWrite = writeConfig.console ?? true;
        this.init();
    }
    init() {
        this._todayDate = new Date().getDate();
        if (this._fileWrite) {
            this._filePath = this.makeLogFilePath();
            this.sweepOldFiles();
            this._logFileStream = fs_1.default.createWriteStream(this._filePath, { flags: 'a' });
        }
    }
    sweepOldFiles() {
        if (!this._fileWrite) {
            return;
        }
        this._todayDate = new Date().getDate();
        let logFiles = this.logFilesInDir();
        for (let i = 0; i < logFiles.length; ++i) {
            let logFile = logFiles[i];
            let date = this.logFileNameToDate(logFile);
            let since = this.daysSince(date);
            let diff = since;
            if (diff > this._history && this._history > 0) {
                fs_1.default.unlinkSync(path_1.default.join(this._dirPath, logFile));
            }
        }
    }
    daysSince(startDate) {
        const today = new Date();
        const millisecondsInDay = 24 * 60 * 60 * 1000; // 24 hours * 60 minutes * 60 seconds * 1000 milliseconds
        const diff = today.getTime() - startDate.getTime();
        const daysPassed = Math.floor(diff / millisecondsInDay);
        return daysPassed;
    }
    logFileNameToDate(fileName) {
        let regexString = `^${this._name}-(\\d{4})\\.(\\d{2})\\.(\\d{2})\\.log$`;
        let regex = new RegExp(regexString);
        let result = regex.exec(fileName);
        if (result == null)
            return new Date();
        let year = parseInt(result[1]);
        let month = parseInt(result[2]) - 1;
        let dayOfMonth = parseInt(result[3]);
        return new Date(year, month, dayOfMonth);
    }
    logFilesInDir() {
        try {
            fs_1.default.existsSync(this._dirPath) || fs_1.default.mkdirSync(this._dirPath);
            let stat = fs_1.default.statSync(this._dirPath);
            if (!stat.isDirectory())
                throw new Error('Log directory is not directory.');
            let files = fs_1.default.readdirSync(this._dirPath);
            return files.filter((file) => {
                let regexString = `^${this._name}-\\d{4}\\.\\d{2}\\.\\d{2}\\.log$`;
                let regex = new RegExp(regexString);
                return regex.test(file);
            });
        }
        catch (e) {
            return [];
        }
    }
    makeLogFilePath() {
        let date = new Date();
        let year = date.getFullYear();
        let month = date.getMonth() + 1;
        let dayOfMonth = date.getDate();
        return path_1.default.join(this._dirPath, `${this._name}-${year}.${month < 10 ? '0' + month : month}.${dayOfMonth < 10 ? '0' + dayOfMonth : dayOfMonth}.log`);
    }
    pushMessage(message) {
        message.day = Date.now();
        if (this._fileWrite) {
            this._logMessageQueue.push(message);
            if (this._logMessageQueue.length == 1) {
                this.printLogMessage();
            }
        }
        else if (this._consoleWrite) {
            console.log(this.makeLogLine(message));
        }
    }
    makeLogLine(message) {
        let dateString = new Date(message.day).toISOString();
        let levelString = message.level.toUpperCase();
        let moduleString = message.module;
        let messageString = message.message;
        let errorString = message.error ? message.error.stack : '';
        return `${dateString} [${levelString}] ${moduleString && moduleString != '' ? moduleString + '::' : ''} ${messageString}\n${errorString && errorString != '' ? errorString + '\n' : ''}`;
    }
    nextLogFile() {
        this._todayDate = new Date().getDate();
        this._filePath = this.makeLogFilePath();
        this._logFileStream?.end();
        this._logFileStream = fs_1.default.createWriteStream(this._filePath, { flags: 'a' });
        this.sweepOldFiles();
    }
    printLogMessage() {
        let message = this._logMessageQueue.shift();
        if (!message) {
            if (this._waitEnd && !this._isEnd) {
                this.close();
            }
            return;
        }
        if (message.day != this._todayDate) {
            this.nextLogFile();
        }
        let logLine = this.makeLogLine(message);
        if (this._fileWrite) {
            this._logFileStream?.write(logLine, (err) => {
                if (err) {
                    console.log(err);
                }
                else {
                    process.nextTick(() => {
                        this.printLogMessage();
                    });
                }
            });
        }
        if (this._consoleWrite) {
            console.log(logLine.substring(0, logLine.length - 1));
        }
    }
    end() {
        if (this._waitEnd || this._isEnd) {
            return;
        }
        this._waitEnd = true;
        if (this._logMessageQueue.length == 0) {
            this.close();
        }
    }
    close() {
        this._logMessageQueue = [];
        this._logFileStream?.end();
        this._isEnd = true;
    }
}
exports.LogWriter = LogWriter;

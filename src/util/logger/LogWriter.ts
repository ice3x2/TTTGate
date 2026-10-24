import {Level, WriteConfig} from "./LoggerConfig"
import fs, {WriteStream} from "fs";
import Path from "path";
import {redactSecretString} from "../SecretRedactor";

interface LogMessage {
    name: string;
    module: string;
    message: string;
    day: number;
    level: Level;
    error?: any;
    /** 파일에 쓸 줄(오류 stack 포함). 큐에 넣을 때 한 번 만든다(#249). */
    line?: string;
    /** 파일 쓰기 대기량에 센 바이트. 큐에서 꺼낼 때 뺀다(#249). */
    size?: number;
}

/** 레벨 순서. 설정한 레벨보다 낮은 로그는 남기지 않는다(#249). */
const LEVEL_ORDER: Record<Level, number> = {debug: 0, info: 1, warn: 2, error: 3};

/**
 * 파일에 아직 쓰지 못한 로그의 상한(바이트)(#249). 디스크가 느리면 쓰기 스트림이 버퍼에 끝없이 쌓는다.
 * 넘으면 파일에는 쓰지 않고(콘솔에는 쓴다) 버린 줄 수를 센 뒤, 다시 쓸 수 있게 되면 한 줄로 남긴다.
 */
const MAX_PENDING_FILE_BYTES = 8 * 1024 * 1024;

class LogWriter {

    private readonly _name : string;
    private readonly _logFilePattern : RegExp;
    private  _filePath : string;
    private readonly _dirPath : string;
    private _logMessageQueue : Array<LogMessage> = [];
    private _logFileStream : fs.WriteStream | undefined;
    private readonly _history : number;
    private readonly _fileWrite : boolean;
    private readonly _consoleWrite : boolean;
    private _todayDate : number = 0;
    private _isUnwritable : boolean = false;
    private _waitEnd : boolean = false;
    private _isEnd : boolean = false;
    private _endWaiters : Array<() => void> = [];
    private readonly _level : Level;
    /**
     * 큐에 있는, 아직 스트림에 넘기지 않은 로그의 바이트(#249).
     * 넣을 때 큐가 비어 있으면 바로 스트림에 쓰므로 큐는 보통 한 줄을 넘지 않는다. 대기량은 주로 스트림의 writableLength 가 맡고,
     * 이 값은 그 사이의 몫을 위한 방어다.
     */
    private _queuedBytes = 0;
    /** 쓰기 대기량이 상한을 넘어 파일에 쓰지 못한 줄 수(#249). */
    private _droppedLines = 0;
    /** drain 을 기다리는 스트림과 그 리스너. 스트림을 바꾸거나 오류가 나면 떼어 낸다(#249). */
    private _drainStream : fs.WriteStream | undefined;
    private _drainListener : (() => void) | undefined;


    public static create(writeConfig: WriteConfig) : LogWriter {
        return new LogWriter(writeConfig);
    }

    private constructor(writeConfig: WriteConfig) {
        this._name = writeConfig.name;
        const escapedName = this._name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        this._logFilePattern = new RegExp(String.raw`^${escapedName}-(\d{4})\.(\d{2})\.(\d{2})\.log$`);
        this._dirPath = writeConfig.path!;
        this._history = writeConfig.history ?? 30;
        this._fileWrite = writeConfig.file ?? true;
        this._consoleWrite = writeConfig.console ?? true;
        this._level = writeConfig.level ?? 'debug';
        this.init();
    }

    private init() {
        this._todayDate = new Date().getDate();
    }

    /** 파일은 첫 기록 때 연다(#208). 도움말처럼 아무것도 기록하지 않는 실행은 logs/ 를 만들지 않는다. */
    private ensureStream() {
        if(this._fileWrite && !this._logFileStream && !this._isUnwritable && !this._isEnd) {
            this._filePath = this.makeLogFilePath();
            this.sweepOldFiles();
            this._logFileStream = fs.createWriteStream(this._filePath, {flags: 'a'});
            this._logFileStream.on('error', (err) => {
                if (!this._isUnwritable) {
                    this._isUnwritable = true;
                    this.disarmDrain();
                    console.error(`Logger '${this._name}' stream error. Disabling further file logging.`, err);
                    this._logFileStream?.end();
                }
            });
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
            let since = this.daysSince(date);
            let diff = since;
            if(diff > this._history && this._history > 0) {
                try {
                    fs.unlinkSync(Path.join(this._dirPath, logFile));
                } catch (e) {
                    console.error(`Failed to delete old log file: ${logFile}`, e);
                }
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
        let result = this._logFilePattern.exec(fileName);
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
            return files.filter((file) => this._logFilePattern.test(file));
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
        if(LEVEL_ORDER[message.level] < LEVEL_ORDER[this._level]) return;
        this.enqueue(message);
    }

    /** 레벨 필터를 거친 로그를 남긴다. 버린 줄 수 알림은 레벨과 상관없이 이 경로로 바로 남긴다(#249). */
    private enqueue(message: LogMessage) {
        message.day = Date.now();
        this.ensureStream();

        if (this._isUnwritable && this._fileWrite) {
            if (this._consoleWrite) {
                console.log(this.makeLogLine(message));
            }
            return;
        }

        if(this._fileWrite) {
            message.line = this.makeLogLine(message);
            message.size = Buffer.byteLength(message.line);
            if(this.pendingFileBytes() + message.size > MAX_PENDING_FILE_BYTES) {
                this.dropFromFile(message);
                return;
            }
            this._queuedBytes += message.size;
            this._logMessageQueue.push(message);
            if (this._logMessageQueue.length == 1) {
                this.printLogMessage();
            }
        } else if(this._consoleWrite) {
            console.log(this.makeLogLine(message));
        }
    }

    /** 파일에 아직 쓰지 못한 바이트: 큐에 있는 것과 쓰기 스트림이 버퍼에 쥔 것(#249). */
    private pendingFileBytes(): number {
        return this._queuedBytes + (this._logFileStream?.writableLength ?? 0);
    }

    /**
     * 쓰기 대기량이 상한을 넘었다. 콘솔에는 쓰고 파일에는 쓰지 않으며 버린 수를 센다(#249).
     * 스트림이 비면(drain) 버린 줄 수를 한 줄로 남긴다.
     */
    private dropFromFile(message: LogMessage) {
        if(this._consoleWrite) {
            console.log((message.line ?? this.makeLogLine(message)).replace(/\n$/, ''));
        }
        this._droppedLines++;
        const stream = this._logFileStream;
        if(this._drainStream || !stream) return;
        // 쓰기가 쌓여 있지 않으면(상한보다 큰 줄 하나만 버린 경우) drain 이 오지 않는다. 바로 알린다.
        if(!stream.writableNeedDrain) {
            process.nextTick(() => this.reportDroppedLines());
            return;
        }
        this._drainStream = stream;
        this._drainListener = () => {
            this._drainStream = undefined;
            this._drainListener = undefined;
            this.reportDroppedLines();
        };
        stream.once('drain', this._drainListener);
    }

    /** drain 을 더는 기다리지 않는다. 끝내거나 바꾼 스트림에는 drain 이 오지 않는다(#249). */
    private disarmDrain() {
        if(this._drainStream && this._drainListener) this._drainStream.removeListener('drain', this._drainListener);
        this._drainStream = undefined;
        this._drainListener = undefined;
    }

    private droppedLinesNotice(count: number): string {
        return `Dropped ${count} log lines from the log file because it could not keep up.`;
    }

    /** 버린 줄 수를 한 줄로 남긴다. 레벨 필터를 거치지 않는다. */
    private reportDroppedLines() {
        const dropped = this._droppedLines;
        if(dropped === 0 || this._isEnd || this._waitEnd) return;
        this._droppedLines = 0;
        this.enqueue({name: this._name, module: 'LogWriter', message: this.droppedLinesNotice(dropped), day: 0, level: 'warn'});
    }

    private makeLogLine(message: LogMessage) : string {
        let dateString = new Date(message.day).toISOString();
        let levelString = message.level.toUpperCase();
        let moduleString = message.module;
        // R2-REQ-05: 로거 최종 write 직전 문자열 redact (post-processor 훅).
        let messageString = redactSecretString(message.message ?? '');
        let errorString = message.error ? redactSecretString(message.error.stack ?? '') : '';
        return `${dateString} [${levelString}] ${moduleString && moduleString != '' ? moduleString + '::' : '' } ${messageString}\n${errorString && errorString != '' ? errorString + '\n' : ''}`;
    }

    private nextLogFile()  {
        this._isUnwritable = false;
        this._todayDate = new Date().getDate();
        this._filePath = this.makeLogFilePath();
        // 옛 스트림에는 drain 이 오지 않는다. 기다리던 것은 풀고, 버린 줄 수는 새 파일에 남긴다(#249).
        this.disarmDrain();
        this._logFileStream?.end();
        this._logFileStream = fs.createWriteStream(this._filePath,  {flags:'a'});
        this._logFileStream.on('error', (err) => {
            if (!this._isUnwritable) {
                this._isUnwritable = true;
                this.disarmDrain();
                console.error(`Logger '${this._name}' stream error. Disabling further file logging.`, err);
                this._logFileStream?.end();
            }
        });
        this.sweepOldFiles();
        if(this._droppedLines > 0) process.nextTick(() => this.reportDroppedLines());
    }

    private printLogMessage() {
        let message = this._logMessageQueue.shift();
        if(message) this._queuedBytes = Math.max(0, this._queuedBytes - (message.size ?? 0));
        if(!message) {
            if(this._waitEnd && !this._isEnd) {
                this.close();
            }
            return;
        }

        if(new Date(message.day).getDate() != this._todayDate) {
            this.nextLogFile();
        }
        let logLine = message.line ?? this.makeLogLine(message);

        if(this._consoleWrite) {
            console.log(logLine.substring(0, logLine.length - 1));
        }

        if(this._fileWrite && !this._isUnwritable) {
            this._logFileStream?.write(logLine, (err) => {
                if(err && !this._isUnwritable) {
                    this._isUnwritable = true;
                    this.disarmDrain();
                    console.error(`Logger '${this._name}' failed to write to file. Disabling further file logging.`, err);
                    this._logFileStream?.end();
                }
            });
        }

        if (this._logMessageQueue.length > 0) {
            process.nextTick(() => {
                this.printLogMessage();
            });
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
        this._isEnd = true;
        const waiters = this._endWaiters.splice(0);
        const stream = this._logFileStream;
        // 끝낸 스트림에는 drain 이 오지 않는다. 버린 줄 수는 닫기 전에 직접 남긴다(#249).
        this.disarmDrain();
        if(this._droppedLines > 0 && stream && !stream.destroyed && !stream.closed && !this._isUnwritable) {
            const dropped = this._droppedLines;
            this._droppedLines = 0;
            const line = this.makeLogLine({name: this._name, module: 'LogWriter', message: this.droppedLinesNotice(dropped), day: Date.now(), level: 'warn'});
            if(this._consoleWrite) console.log(line.replace(/\n$/, ''));
            stream.write(line);
        }
        if(!stream || stream.destroyed || stream.closed) {
            stream?.end();
            waiters.forEach(resolve => resolve());
            return;
        }
        stream.end(() => waiters.forEach(resolve => resolve()));
    }

    /** 쌓인 기록을 모두 파일에 쓰고 스트림을 닫은 뒤 끝나는 end()(#207). 종료 직전 로그가 잘리지 않게 한다. */
    public endAsync(): Promise<void> {
        if(this._isEnd) {
            const stream = this._logFileStream;
            if(!stream || stream.closed || stream.writableFinished) return Promise.resolve();
            return new Promise(resolve => stream.once('finish', () => resolve()));
        }
        const done = new Promise<void>(resolve => this._endWaiters.push(resolve));
        this.end();
        return done;
    }

}


export { LogWriter, LogMessage};

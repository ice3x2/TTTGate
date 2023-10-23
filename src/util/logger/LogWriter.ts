
interface LogMessage {
    name: string;
    module: string;
    message: string;
    date: Date;
    error: Error;
}

class LogWriter {

    private _logMessageQueue : Array<LogMessage> = [];
    private _logFileStream:


}

export default LogWriter;

import {Level}  from "./LoggerConfig";
import {LogMessage } from "./LogWriter";

interface OnMessage {
    (message: LogMessage) : void;
}

class Logger {
    private readonly _onMessage : OnMessage;
    private readonly _name : string = '';
    private readonly _module : string = '';

    private appendMessage(level: Level, message: string, e?: Error)  {
        let logMessage : LogMessage =  {
            name: this._name,
            module: this._module,
            message: message,
            day: new Date().getDate(),
            level: level,
            error:e
        };
        this._onMessage(logMessage);
    }


    public static create(name: string, module: string, onMessage: OnMessage) : Logger {
        return new Logger(onMessage, name, module);
    }



    private constructor(onMessage: OnMessage, name: string, module: string) {
        this._onMessage = onMessage;
        this._name = name;
        this._module = module;

    }

    public debug(message: string) : void {
        this.appendMessage('debug', message);
    }

    public info(message: string) : void {
        this.appendMessage('info', message);
    }

    public warn(message: string, e?: Error) : void {
        this.appendMessage('warn', message);
    }

    public error(message: string, e?: Error) : void {
        this.appendMessage('error', message, e);
    }


}

export default Logger;
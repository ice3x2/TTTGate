import { LogMessage } from "./LogWriter";
interface OnMessage {
    (message: LogMessage): void;
}
declare class Logger {
    private readonly _onMessage;
    private readonly _name;
    private readonly _module;
    private appendMessage;
    static create(name: string, module: string, onMessage: OnMessage): Logger;
    private constructor();
    debug(message: string): void;
    info(message: string): void;
    warn(message: string, e?: any): void;
    error(message: string, e?: any): void;
}
export default Logger;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Logger {
    _onMessage;
    _name = '';
    _module = '';
    appendMessage(level, message, e) {
        let logMessage = {
            name: this._name,
            module: this._module,
            message: message,
            day: new Date().getDate(),
            level: level,
            error: e
        };
        this._onMessage(logMessage);
    }
    static create(name, module, onMessage) {
        return new Logger(onMessage, name, module);
    }
    constructor(onMessage, name, module) {
        this._onMessage = onMessage;
        this._name = name;
        this._module = module;
    }
    debug(message) {
        this.appendMessage('debug', message);
    }
    info(message) {
        this.appendMessage('info', message);
    }
    warn(message, e) {
        this.appendMessage('warn', message, e);
    }
    error(message, e) {
        this.appendMessage('error', message, e);
    }
}
exports.default = Logger;

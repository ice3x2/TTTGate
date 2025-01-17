"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Errors {
    static toString(error) {
        if (error == undefined) {
            return "";
        }
        if (error instanceof Error) {
            let str = Errors.printError(error);
            let causeList = Errors.getCauseList(error);
            for (let i = 0; i < causeList.length; i++) {
                str += "\nCaused by: " + Errors.printError(causeList[i]);
            }
            return str;
        }
        else {
            return error.toString();
        }
    }
    static getCauseList(error) {
        let cause = error.cause;
        if (cause == undefined) {
            return [];
        }
        if (cause instanceof Error) {
            return [cause, ...Errors.getCauseList(cause)];
        }
        return [];
    }
    static getCause(error) {
        let cause = error.cause;
        if (cause == undefined) {
            return undefined;
        }
        if (cause instanceof Error) {
            return cause;
        }
        return undefined;
    }
    static printError(error) {
        let message = error.message;
        if (message == undefined) {
            return "";
        }
        return message + "\n\t" + Errors.printStackTrace(error);
    }
    static printStackTrace(error) {
        let stack = error.stack;
        if (stack == undefined) {
            return "";
        }
        let stackSplit = stack.split("\n");
        let result = "";
        for (let i = 0; i < stackSplit.length; i++) {
            let line = stackSplit[i];
            if (line.indexOf("at ") == 0) {
                result += line + "\n\t";
            }
        }
        return result;
    }
}
exports.default = Errors;

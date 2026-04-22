import { redactSecretString } from "./SecretRedactor";

class Errors {
    public static toString(error: any) : string {
        const raw = Errors._rawToString(error);
        // R2-REQ-05: 최종 출력 전 민감정보 redact.
        return redactSecretString(raw);
    }

    /**
     * R2-REQ-05: 구조화된 에러 직렬화. 전 필드 redact 적용.
     */
    public static serialize(error: any) : { message: string; stack: string; cause: string } {
        if(error == undefined) return { message: "", stack: "", cause: "" };
        if(error instanceof Error) {
            const cause = Errors.getCause(error);
            return {
                message: redactSecretString(error.message ?? ""),
                stack: redactSecretString(error.stack ?? ""),
                cause: cause ? Errors.toString(cause) : ""
            };
        }
        return { message: redactSecretString(String(error)), stack: "", cause: "" };
    }

    private static _rawToString(error: any) : string {
        if(error == undefined) {
            return "";
        }
        if(error instanceof Error) {
            let str = Errors.printError(error);
            let causeList = Errors.getCauseList(error);
            for(let i = 0; i < causeList.length; i++) {
                str += "\nCaused by: " + Errors.printError(causeList[i]);
            }
            return str;
        } else {
            return error.toString();
        }
    }

    private static getCauseList (error: Error) : Array<Error> {
        let cause = error.cause;
        if(cause == undefined) {
            return [];
        }
        if(cause instanceof Error) {
            return [cause, ...Errors.getCauseList(cause)];
        }
        return [];

    }

    private static getCause(error: Error) : Error | undefined {
        let cause = error.cause;
        if(cause == undefined) {
            return undefined;
        }
        if(cause instanceof Error) {
            return cause;
        }
        return undefined;
    }

    private static printError(error: Error) : string {
        // R2-REQ-05: message/stack 개별 redact.
        let message = error.message;
        if(message == undefined) {
            return "";
        }
        return redactSecretString(message) + "\n\t" + Errors.printStackTrace(error);
    }

    private static printStackTrace(error: Error) : string {
        let stack = error.stack;
        if(stack == undefined) {
            return "";
        }
        let stackSplit = stack.split("\n");
        let result = "";
        for(let i = 0; i < stackSplit.length; i++) {
            let line = stackSplit[i];
            if(line.indexOf("at ") == 0) {
                result += redactSecretString(line) + "\n\t";
            }
        }
        return result;
    }
}

export default Errors;

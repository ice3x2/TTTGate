import Logger from "./Logger";
import {LoggerConfig} from "./LoggerConfig";
import Path from "path";
import LogWriter from "./LogWriter";


class LoggerFactory {

    private static _loggerConfig = LoggerConfig.create(Path.join(__dirname, 'logs'));
    private static _logWriterMap: Map<string, LogWriter> = new Map<string, LogWriter>();

    public static getLogger(name: string, module?: string) : Logger {


    }



}

export default LoggerFactory;
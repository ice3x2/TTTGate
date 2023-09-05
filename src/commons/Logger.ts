import winston from 'winston';
import winstonDaily from 'winston-daily-rotate-file';
import Environment from "../Environment";

const { combine, timestamp, printf } = winston.format;
const logDir = Environment.path.logDir;  // logs 디렉토리 하위에 로그 파일 저장

const logFormat = printf(info => {
    return `${info.timestamp} [${info.level}] ${info.message}`;
});


const logger = winston.createLogger({
    format: combine(

        timestamp({
            format: 'YYYY-MM-DD HH:mm:ss',
        }),
        logFormat,
    ),
    transports: [
        new winstonDaily({
            level: 'info',
            datePattern: 'YYYY-MM-DD',
            dirname: logDir,
            filename: `%DATE%.log`,
            maxFiles: 30,  // 30일치 로그 파일 저장
            zippedArchive: true,
        }),
        new winstonDaily({
            level: 'error',
            datePattern: 'YYYY-MM-DD',
            dirname: logDir + '/error',  // error.log 파일은 /logs/error 하위에 저장
            filename: `%DATE%.error.log`,
            maxFiles: 30,
            zippedArchive: true,
        })
    ],
});


logger.add(new winston.transports.Console({

    format: winston.format.combine(
        winston.format.colorize({ all: true})
    )
}));



export { logger };
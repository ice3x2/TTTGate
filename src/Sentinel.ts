import { spawn } from 'child_process';
import Path from "path";
import {clearInterval} from "timers";
import {logger} from "./commons/Logger";
import {assignWith, forEach} from "lodash";
const find = require('find-process');





class Sentinel {

    private _pathList: Array<string> = [];
    private _argv: Array<string> = [];

    public static isDaemonMode(): boolean {
        return process.argv.find((arg) => arg == '-daemon') != undefined;
    }

    public static hasExecuteMode(): boolean {
        return process.env.EXECUTE_MODE != undefined;
    }


    public static create(executePath: string, argv: Array<string>, devMode: boolean): Sentinel {
        let sentinel = new Sentinel();
        sentinel._argv = argv;
        if (devMode) {
            sentinel.makeDevPathList(executePath);
        } else {
            sentinel.makeRuntimePathList(executePath);
        }
        return sentinel;
    }


    private makeDevPathList(exePath: string) {
        this._pathList = [process.argv[0], Path.join(Path.join(process.argv[1],'..'), 'node_modules', 'ts-node-dev', 'lib', 'bin.js'), '--project', Path.join(process.cwd(), 'tsconfig.json'), exePath]
        this._pathList = [...this._pathList, ...this._argv];
    }

    private makeRuntimePathList(exePath: string) {
        this._pathList = [exePath, ...this._argv];
    }


    constructor() {
    }

    /**
     * Start sentinel
     * @returns true 면 boot 혹은 sentinel 프로세스 밖에서 바로 true 해야함., false 면 부모 프로세스
     */
    public start(): boolean {
        if (this._argv.find((arg) => arg == '-daemon') == undefined) {
            Sentinel.writeForegroundPID();
            return false;
        }
        if (process.env.EXECUTE_MODE == undefined) {
            this.boot();
        } else if (process.env.EXECUTE_MODE == 'sentinel') {
            this.runSentinel();
        } else if (process.env.EXECUTE_MODE == 'execute') {
            this.runApp();
            return false;
        }
        return true;

    }

    private runApp() {
    }

    private static writeForegroundPID() {
        Sentinel.writePidFile(process.pid, 'foreground');
    }

    private static processKill(type : 'app' | 'sentinel' | 'foreground') {
        let pidList = this.readPIDFile(type);
        let currentPID : number | undefined = undefined;
        for(let pid of pidList) {
            try {
                if(pid == process.pid) {
                    currentPID = pid;
                    continue;
                }
                if(process.kill(pid)) {
                    logger.warn(type +' proc killed. pid:' + pid)
                }
            } catch (e) {

            }
        }
        Sentinel.deletePIDFile(type);
        if(currentPID != undefined) {
            Sentinel.writePidFile(currentPID, type);
        }
    }

    public static stop() {
        Sentinel.processKill('app');
        Sentinel.processKill('sentinel');
        Sentinel.processKill('foreground');
    }




    private boot() {
        let appPID = Sentinel.readPIDFile('app');
        let sentinelPID = Sentinel.readPIDFile('sentinel');
        let foregroundPID = Sentinel.readPIDFile('foreground');
        if(sentinelPID.length > 0) {

            if(sentinelPID.length > 0) {
                logger.warn('Already running sentinel pid:' + sentinelPID);
                Sentinel.processKill('sentinel');
            }
            if(appPID.length > 0) {
                logger.warn('Already running app killed. pid:' + appPID);
                Sentinel.processKill('app');
            }
            if(foregroundPID.length > 0) {
                logger.warn('Already running foreground. pid:' + foregroundPID);
                Sentinel.processKill('foreground');
            }
            this.startAllProcess();

        } else {
            Sentinel.processKill('app');
            Sentinel.processKill('foreground');
            this.startAllProcess();
        }
    }

    private static deletePIDFile(type: 'app' | 'sentinel' | 'foreground') {
        const fs = require('fs');
        if(fs.existsSync(`.pid_${type}`)) {
            fs.unlinkSync(`.pid_${type}`);
        }
    }

    private startAllProcess() {
        logger.info('Start daemon and sentinel mode.');
        this.startApp((pid) => {
            logger.info('App started: ' + pid);
            Sentinel.writePidFile(pid, 'app');
            this.startSentinel(pid, (pid) => {
                logger.info('Sentinel started: ' + pid);
                Sentinel.writePidFile(pid, 'sentinel');
            });
        });
    }



    private static readPIDFile(type: 'app' | 'sentinel' | 'foreground') : Array<number> {
        const fs = require('fs');
        if(fs.existsSync(`.pid_${type}`)) {
            let str = fs.readFileSync(`.pid_${type}`).toString();
            let list = str.split('\n');
            let result : Array<number> = [];
            for(let item of list) {
                item = item.trim();
                if(item.trim() != '') {
                    let pid = parseInt(item.trim());
                    if(isNaN(pid) || pid == undefined) {
                        continue;
                    }
                    result.push(pid);
                }
            }
            return result;
        }
        return [];
    }

    private static writePidFile(pid: number, type: 'app' | 'sentinel' | 'foreground') {
        const fs = require('fs');
        fs.writeFileSync(`.pid_${type}`, pid.toString() + '\n', {encoding: 'utf-8', flag: 'a'});
    }

    public runSentinel() {
        this.startScanPid(parseInt(process.env.APP_PID!));
    }

    private restartApp() {
        this.startApp((pid) => {
            console.log('App started: ' + pid);
            Sentinel.writePidFile(pid, 'app');
            this.startScanPid(pid);
        });
    }

    private startScanPid(pid: number) {
        let intervalID = setInterval(() => {
            find('pid', pid).then((list: Array<any>) => {
                if(list.length == 0) {
                    logger.warn('[SENTINEL]','App not found. pid:' + pid);
                    clearInterval(intervalID);
                    setTimeout(() => {
                        logger.info('[SENTINEL]','Restart app');
                        this.restartApp();
                    }, 3000);
                }
            }).catch((err: any) => {
                logger.error('[SENTINEL]','Error on find process: ' + pid, err);
                logger.info('[SENTINEL]','Stop app')
                process.kill(process.pid, 'SIGTERM');
                logger.info('[SENTINEL]','Stop sentinel')
                clearInterval(intervalID);
                process.kill(1);
                return;
            });
        }, 3000);

    }


    private startSentinel(firstAppPID: number, onPid: (pid: number) => void) {
        const controller = new AbortController();
        const {signal} = controller;
        const child = spawn('node', this._pathList, {
            signal,
            detached: true,
            env: {
                ...process.env,
                EXECUTE_MODE: 'sentinel',
                APP_PID: firstAppPID.toString()
            },
            stdio: ['ignore', 'ignore', 'ignore']
        });
        child.unref();
        child.on('spawn', () => {
            onPid(child.pid!);
        });
    }

    private startApp(onPid: (pid: number) => void) {
        const controller = new AbortController();
        const {signal} = controller;
        const child = spawn('node', this._pathList, {
            signal,
            detached: true,
            env: {
                ...process.env,
                EXECUTE_MODE: 'execute'
            },
            stdio: ['ignore', 'ignore', 'ignore']
        });
        child.unref();
        child.on('spawn', () => {
            onPid(child.pid!);
        });

    }
}

export default Sentinel;

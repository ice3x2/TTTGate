import { spawn } from 'child_process';
import Path from "path";
import {clearInterval} from "timers";
import Environment from "./Environment";
const find = require('find-process');

import LoggerFactory  from "./util/logger/LoggerFactory";
const logger = LoggerFactory.getLogger('boot', 'Sentinel');





class Sentinel {

    private _executePath: string = '';
    private _argvList: Array<string> = [];
    private _argv: Array<string> = [];

    public static isDaemonMode(): boolean {
        return process.argv.find((arg) => arg == '-daemon') != undefined;
    }

    public static hasExecuteMode(): boolean {
        return process.env.EXECUTE_MODE != undefined;
    }

    public static isSentinelMode(): boolean {
        return process.env.EXECUTE_MODE == 'sentinel';
    }


    public static create(devMode: boolean): Sentinel {


        let sentinel = new Sentinel();
        if (devMode) {
            sentinel._argv = process.argv;
            sentinel.makeDevPathList();
        } else {
            sentinel._argv = process.argv;
            sentinel.makeRuntimePathList();
        }

        return sentinel;
    }


    private makeDevPathList() {
        this._executePath = 'node';
        let root = Path.join(process.argv[1],'..','..')
        //this._argvList = [Path.join(root, 'node_modules', 'ts-node-dev', 'lib', 'bin.js'), '--project', Path.join(root, 'tsconfig.json'), process.argv[1]]
        this._argvList = [Path.join(root, 'node_modules', 'ts-node', 'dist', 'bin.js'), '--project', Path.join(root, 'tsconfig.json'), process.argv[1]]
        this._argvList = [...this._argvList, ...process.argv.slice(2)];

    }

    private makeRuntimePathList() {
        this._executePath = process.argv[0];
        this._argvList = process.argv.slice(1);

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

        Sentinel.writePidFile(process.pid,  'foreground');
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
        let path = Path.join(Environment.path.binDir, `.pid_${type}`);
        if(fs.existsSync(path)) {
            fs.unlinkSync(path);
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
        let path = Path.join(Environment.path.binDir, `.pid_${type}`);
        if(fs.existsSync(path)) {
            let str = fs.readFileSync(path).toString();
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
        fs.writeFileSync(Path.join(Environment.path.binDir, `.pid_${type}`), pid.toString() + '\n', {encoding: 'utf-8', flag: 'a'});
    }

    public runSentinel() {
        this.startScanPid(parseInt(process.env.APP_PID!));
    }

    private restartApp() {
        this.startApp((pid) => {
            Sentinel.writePidFile(pid, 'app');
            this.startScanPid(pid);
        });
    }

    private startScanPid(pid: number) {
        let intervalID = setInterval(() => {
            find('pid', pid).then((list: Array<any>) => {
                if(list.length == 0) {
                    logger.warn('App not found. pid:' + pid);
                    clearInterval(intervalID);
                    setTimeout(() => {
                        logger.info('Restart app');
                        this.restartApp();
                    }, 3000);
                }
            }).catch((err: any) => {
                logger.error('Error on find process: ' + pid, err);
                logger.info('Stop app')
                process.kill(process.pid, 'SIGTERM');
                logger.info('Stop sentinel')
                clearInterval(intervalID);
                process.kill(1);
                return;
            });
        }, 3000);

    }


    private startSentinel(firstAppPID: number, onPid: (pid: number) => void) {
        this.exec('sentinel', firstAppPID, onPid);
    }

    private startApp(onPid: (pid: number) => void) {
        this.exec('execute', 0, onPid);
    }

    private exec(type: 'execute' | 'sentinel',pid: number, onPid: (pid: number) => void) {
        const controller = new AbortController();
        const {signal} = controller;

        //console.log(this._executePath, this._argvList);

        const child = spawn(this._executePath, this._argvList, {
            signal,
            detached: true,
            env: {
                ...process.env,
                EXECUTE_MODE: type,
                APP_PID: pid.toString()
            },
            stdio: ['ignore', 'ignore', 'ignore']
            //stdio: ['ignore', 'pipe', 'pipe']
        });
        child.unref();
        /*child.stdout!.on('data', (data) => {
            console.log(data.toString());
        });
        child.stderr!.on('data', (data) => {
            console.log(data.toString());
        });*/
        child.on('spawn', () => {
            onPid(child.pid!);
        });
    }
}

export default Sentinel;

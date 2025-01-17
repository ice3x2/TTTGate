"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const timers_1 = require("timers");
const Environment_1 = __importDefault(require("./Environment"));
const find = require('find-process');
const LoggerFactory_1 = __importDefault(require("./util/logger/LoggerFactory"));
const logger = LoggerFactory_1.default.getLogger('boot', 'Sentinel');
class Sentinel {
    _executePath = '';
    _argvList = [];
    _argv = [];
    static isDaemonMode() {
        return process.argv.find((arg) => arg == '-daemon') != undefined;
    }
    static hasExecuteMode() {
        return process.env.EXECUTE_MODE != undefined;
    }
    static isSentinelMode() {
        return process.env.EXECUTE_MODE == 'sentinel';
    }
    static create(devMode) {
        let sentinel = new Sentinel();
        if (devMode) {
            sentinel._argv = process.argv;
            sentinel.makeDevPathList();
        }
        else {
            sentinel._argv = process.argv;
            sentinel.makeRuntimePathList();
        }
        return sentinel;
    }
    makeDevPathList() {
        this._executePath = 'node';
        let root = path_1.default.join(process.argv[1], '..', '..');
        //this._argvList = [Path.join(root, 'node_modules', 'ts-node-dev', 'lib', 'bin.js'), '--project', Path.join(root, 'tsconfig.json'), process.argv[1]]
        this._argvList = [path_1.default.join(root, 'node_modules', 'ts-node', 'dist', 'bin.js'), '--project', path_1.default.join(root, 'tsconfig.json'), process.argv[1]];
        this._argvList = [...this._argvList, ...process.argv.slice(2)];
    }
    makeRuntimePathList() {
        this._executePath = process.argv[0];
        this._argvList = process.argv.slice(1);
    }
    constructor() {
    }
    /**
     * Start sentinel
     * @returns true 면 boot 혹은 sentinel 프로세스 밖에서 바로 true 해야함., false 면 부모 프로세스
     */
    start() {
        if (this._argv.find((arg) => arg == '-daemon') == undefined) {
            Sentinel.writeForegroundPID();
            return false;
        }
        if (process.env.EXECUTE_MODE == undefined) {
            this.boot();
        }
        else if (process.env.EXECUTE_MODE == 'sentinel') {
            this.runSentinel();
        }
        else if (process.env.EXECUTE_MODE == 'execute') {
            this.runApp();
            return false;
        }
        return true;
    }
    runApp() {
    }
    static writeForegroundPID() {
        Sentinel.writePidFile(process.pid, 'foreground');
    }
    static processKill(type) {
        let pidList = this.readPIDFile(type);
        let currentPID = undefined;
        for (let pid of pidList) {
            try {
                if (pid == process.pid) {
                    currentPID = pid;
                    continue;
                }
                if (process.kill(pid)) {
                    logger.warn(type + ' proc killed. pid:' + pid);
                }
            }
            catch (e) {
            }
        }
        Sentinel.deletePIDFile(type);
        if (currentPID != undefined) {
            Sentinel.writePidFile(currentPID, type);
        }
    }
    static stop() {
        Sentinel.processKill('app');
        Sentinel.processKill('sentinel');
        Sentinel.processKill('foreground');
    }
    boot() {
        let appPID = Sentinel.readPIDFile('app');
        let sentinelPID = Sentinel.readPIDFile('sentinel');
        let foregroundPID = Sentinel.readPIDFile('foreground');
        if (sentinelPID.length > 0) {
            if (sentinelPID.length > 0) {
                logger.warn('Already running sentinel pid:' + sentinelPID);
                Sentinel.processKill('sentinel');
            }
            if (appPID.length > 0) {
                logger.warn('Already running app killed. pid:' + appPID);
                Sentinel.processKill('app');
            }
            if (foregroundPID.length > 0) {
                logger.warn('Already running foreground. pid:' + foregroundPID);
                Sentinel.processKill('foreground');
            }
            this.startAllProcess();
        }
        else {
            Sentinel.processKill('app');
            Sentinel.processKill('foreground');
            this.startAllProcess();
        }
    }
    static deletePIDFile(type) {
        const fs = require('fs');
        let path = path_1.default.join(Environment_1.default.path.binDir, `.pid_${type}`);
        if (fs.existsSync(path)) {
            fs.unlinkSync(path);
        }
    }
    startAllProcess() {
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
    static readPIDFile(type) {
        const fs = require('fs');
        let path = path_1.default.join(Environment_1.default.path.binDir, `.pid_${type}`);
        if (fs.existsSync(path)) {
            let str = fs.readFileSync(path).toString();
            let list = str.split('\n');
            let result = [];
            for (let item of list) {
                item = item.trim();
                if (item.trim() != '') {
                    let pid = parseInt(item.trim());
                    if (isNaN(pid) || pid == undefined) {
                        continue;
                    }
                    result.push(pid);
                }
            }
            return result;
        }
        return [];
    }
    static writePidFile(pid, type) {
        const fs = require('fs');
        fs.writeFileSync(path_1.default.join(Environment_1.default.path.binDir, `.pid_${type}`), pid.toString() + '\n', { encoding: 'utf-8', flag: 'a' });
    }
    runSentinel() {
        this.startScanPid(parseInt(process.env.APP_PID));
    }
    restartApp() {
        this.startApp((pid) => {
            Sentinel.writePidFile(pid, 'app');
            this.startScanPid(pid);
        });
    }
    startScanPid(pid) {
        let intervalID = setInterval(() => {
            find('pid', pid).then((list) => {
                if (list.length == 0) {
                    logger.warn('App not found. pid:' + pid);
                    (0, timers_1.clearInterval)(intervalID);
                    setTimeout(() => {
                        logger.info('Restart app');
                        this.restartApp();
                    }, 3000);
                }
            }).catch((err) => {
                logger.error('Error on find process: ' + pid, err);
                logger.info('Stop app');
                process.kill(process.pid, 'SIGTERM');
                logger.info('Stop sentinel');
                (0, timers_1.clearInterval)(intervalID);
                process.kill(1);
                return;
            });
        }, 3000);
    }
    startSentinel(firstAppPID, onPid) {
        this.exec('sentinel', firstAppPID, onPid);
    }
    startApp(onPid) {
        this.exec('execute', 0, onPid);
    }
    exec(type, pid, onPid) {
        const controller = new AbortController();
        const { signal } = controller;
        //console.log(this._executePath, this._argvList);
        const child = (0, child_process_1.spawn)(this._executePath, this._argvList, {
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
            onPid(child.pid);
        });
    }
}
exports.default = Sentinel;

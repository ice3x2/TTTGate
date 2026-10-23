import { spawn, spawnSync } from 'child_process';
import fs from "fs";
import Path from "path";
import {clearInterval} from "timers";
import Environment from "./Environment";

import LoggerFactory  from "./util/logger/LoggerFactory";
import {clearConfigErrorMarker, hasConfigErrorMarker} from "./util/ConfigExit";
const logger = LoggerFactory.getLogger('boot', 'Sentinel');

type PidType = 'app' | 'sentinel' | 'foreground';

/**
 * PID 파일 한 줄(#256). 예전 형식(숫자만)도 읽는다.
 * - ticks: Linux 의 프로세스 시작 tick(/proc/<pid>/stat 22번째 필드). 시계가 보정돼도 바뀌지 않으므로 Linux 에서는 이것으로 본다.
 * - start: 프로세스 시작 시각(ms). tick 이 없을 때(Windows) 재사용된 PID 를 가려내는 데 쓴다.
 * - exe: 실행 파일 경로(알 때만).
 */
type PidEntry = {pid: number, start?: number, ticks?: number, exe?: string};

/** 실제 프로세스의 시작 시각·tick·실행 파일 경로(#256). */
type ProcessIdentity = {start?: number, ticks?: number, exe?: string, cmdline?: string[]};

/** 기록과 실제 프로세스의 비교 결과. 'unknown' 은 OS 에 물을 수 없었던 경우다(일시적 실패일 수 있다). */
type IdentityMatch = 'match' | 'mismatch' | 'unknown';

/** 기록한 시작 시각과 실제 시작 시각의 허용 차이(ms). */
const START_TOLERANCE_MS = 3000;
/** 기록한 시작 tick 과 실제 tick 의 허용 차이(Linux, 1 tick = 10ms). */
const START_TOLERANCE_TICKS = 2;
/** Windows 에서 프로세스 정보를 묻는 데 쓰는 최대 시간(ms). */
const IDENTITY_QUERY_TIMEOUT_MS = 5000;





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

    /**
     * foreground 서버와 클라이언트는 같은 파일을 쓴다. 자기 항목을 덧붙이기만 한다(#256).
     * 읽고 덮어쓰면, 동시에 뜬 다른 쪽이 그 사이 쓴 항목을 잃는다. 그러면 그 프로세스를 stop 으로 멈출 수 없고
     * 데몬 부팅 검사도 그 프로세스를 보지 못한다. 죽은 항목은 stop 과 데몬 부팅이 정리하고,
     * 남은 항목이 재사용된 PID 여도 stop 이 신원을 확인하므로 다른 프로그램을 끝내지 않는다.
     */
    private static writeForegroundPID() {
        // 같은 PID 의 항목이라도 앞서 죽은 프로세스의 것(PID 재사용)일 수 있다. 신원까지 같을 때만 건너뛴다.
        if(Sentinel.readPIDFile('foreground').some((entry) => entry.pid == process.pid && Sentinel.matchRecordedProcess(entry) === 'match')) return;
        Sentinel.appendPidEntry({pid: process.pid, start: Date.now() - process.uptime() * 1000,
            ticks: process.platform === 'linux' ? Sentinel.processIdentity(process.pid)?.ticks : undefined, exe: process.execPath}, 'foreground');
    }

    private static appendPidEntry(entry: PidEntry, type: PidType) {
        const path = Path.join(Environment.path.binDir, `.pid_${type}`);
        try {
            // 손으로 고쳐 끝에 줄바꿈이 없는 파일이면 새 줄에서 시작한다(앞 줄과 붙으면 그 줄을 읽지 못한다).
            const needsNewline = fs.existsSync(path) && fs.statSync(path).size > 0 && !fs.readFileSync(path, 'utf-8').endsWith('\n');
            fs.appendFileSync(path, (needsNewline ? '\n' : '') + JSON.stringify(entry) + '\n', {encoding: 'utf-8'});
        } catch (e) {
            Sentinel.reportPidFileError(path, e);
        }
    }

    /**
     * 기록한 프로세스를 끝내고 PID 파일을 남길 항목으로 다시 쓴다.
     * 한계: 읽은 뒤 다시 쓰기 전에 foreground 프로세스가 새로 떠서 덧붙인 항목은 잃을 수 있다(stop 과 동시에 시작할 때만).
     */
    private static processKill(type : PidType) {
        let entries = this.readPIDFile(type);

        // 남길 항목: 자기 자신, 그리고 살아 있지만 끝내지 못한(확인할 수 없거나 다른 사용자로 도는) 프로세스.
        // 지우면 그 프로세스를 다시는 stop 으로 멈출 수 없다.
        const keep : PidEntry[] = [];
        for(let entry of entries) {
            if(entry.pid == process.pid) {
                keep.push(entry);
                continue;
            }
            const state = Sentinel.processState(entry.pid);
            if(state === 'dead') continue;
            // 재사용된 PID 를 끝내지 않도록 TTTGate 가 기록한 그 프로세스인지 확인한다(#256).
            const match = Sentinel.matchRecordedProcess(entry);
            if(match === 'mismatch') {
                logger.warn(`${type} pid ${entry.pid} now belongs to another process; not stopping it`);
                continue;
            }
            if(state === 'eperm') {
                // 다른 사용자(관리자·root·SYSTEM)의 프로세스라 신호를 보낼 수 없다. 기록과 같은 TTTGate 면 그 사용자로 멈춰야 하고,
                // 확인할 수 없으면(Windows 는 권한 밖 프로세스의 정보를 주지 않는다) 기록만 남긴다(#256).
                logger.warn(match === 'match'
                    ? `${type} pid ${entry.pid} is TTTGate running as another user; stop it as that user`
                    : `${type} pid ${entry.pid} belongs to another user's process and could not be confirmed; not stopping it`);
                keep.push(entry);
                continue;
            }
            if(match === 'unknown') {
                logger.warn(`${type} pid ${entry.pid} is running but could not be confirmed as the recorded TTTGate process; not stopping it. Stop it manually if needed.`);
                keep.push(entry);
                continue;
            }
            try {
                if(process.kill(entry.pid)) {
                    logger.warn(type +' proc killed. pid:' + entry.pid)
                }
            } catch (e) {

            }
        }
        // 지운 뒤 다시 쓰지 않고 바로 덮어쓴다. 쓰기가 실패해도 남기려던 항목이 사라지지 않는다.
        // 예전(덧붙이기) 형식의 여러 줄 파일이면 남길 항목을 모두 적는다. 자기 자신을 앞에 둔다.
        keep.sort((left, right) => (left.pid == process.pid ? -1 : 0) - (right.pid == process.pid ? -1 : 0));
        if(keep.length > 0) Sentinel.writePidEntries(keep, type); else Sentinel.deletePIDFile(type);
    }

    /**
     * 새 데몬 쌍을 막는, 남은 다른 프로세스들(stop 으로 끝내지 못해 남긴 항목).
     * - 신호를 보낼 수 있는데 확인하지 못한 프로세스
     * - 다른 사용자로 도는, 기록과 같은 TTTGate
     * 다른 사용자의 프로세스인데 확인할 수 없는 것은 막지 않는다(재사용된 PID 일 수 있고, 막으면 영영 뜨지 못한다).
     */
    private static liveEntries(type: PidType): PidEntry[] {
        return Sentinel.readPIDFile(type).filter((entry) => {
            if(entry.pid == process.pid) return false;
            const state = Sentinel.processState(entry.pid);
            if(state === 'alive') return true;
            return state === 'eperm' && Sentinel.matchRecordedProcess(entry) === 'match';
        });
    }

    /** 신호 0 으로 본 프로세스 상태. 'eperm' 은 살아 있지만 다른 사용자의 프로세스다(#256). */
    private static processState(pid: number): 'alive' | 'eperm' | 'dead' {
        if(!Number.isSafeInteger(pid) || pid <= 0) return 'dead';
        try {
            process.kill(pid, 0);
            return 'alive';
        } catch (e) {
            return (e as NodeJS.ErrnoException).code === 'EPERM' ? 'eperm' : 'dead';
        }
    }

    /**
     * PID 파일의 항목이 지금 그 PID 를 쓰는 프로세스와 같은지 본다(#256).
     * - tick 이 있으면(Linux) 시작 tick 이 같아야 한다. 벽시계와 달리 시계 보정(NTP)에 흔들리지 않는다.
     * - 시작 시각만 있으면(Windows) 허용 차이 안이어야 한다.
     * - 실행 파일을 둘 다 알면 같아야 한다.
     * - 예전 형식(숫자만)은 실행 파일이 지금 실행 중인 TTTGate 와 같아야 한다(업그레이드 직후 stop 을 위해).
     *   node 로 실행할 때(개발 모드, `node build/src/app.js`)는 실행 파일만으로는 TTTGate 인지 알 수 없다.
     *   Linux 는 실행 인자에 이 앱의 진입 스크립트(process.argv[1])가 있어야 한다. Windows 는 실행 인자를 보지 않으므로
     *   같은 node 로 도는 다른 프로세스도 통과할 수 있다.
     *   pkg 바이너리는 실행 파일이 TTTGate 자신이라 실행 파일로 충분하다. 진입 스크립트는 바이너리 안(/snapshot)이라
     *   사용자가 직접 띄운 서버의 실행 인자에는 없으므로 보지 않는다.
     */
    public static matchRecordedProcess(entry: PidEntry): IdentityMatch {
        const actual = Sentinel.processIdentity(entry.pid);
        if(!actual) return 'unknown';
        if(entry.exe !== undefined && actual.exe !== undefined && !Sentinel.samePath(entry.exe, actual.exe)) return 'mismatch';
        if(entry.ticks !== undefined && actual.ticks !== undefined) {
            return Math.abs(actual.ticks - entry.ticks) <= START_TOLERANCE_TICKS ? 'match' : 'mismatch';
        }
        if(entry.start !== undefined) {
            if(actual.start === undefined) return 'unknown';
            return Math.abs(actual.start - entry.start) <= START_TOLERANCE_MS ? 'match' : 'mismatch';
        }
        if(actual.exe === undefined) return 'unknown';
        if(!Sentinel.samePath(actual.exe, process.execPath)) return 'mismatch';
        const entryScript = process.argv[1];
        const runsUnderNode = (process as unknown as {pkg?: unknown}).pkg === undefined;
        if(process.platform === 'linux' && runsUnderNode && entryScript) {
            if(actual.cmdline === undefined) return 'unknown';
            return actual.cmdline.includes(entryScript) ? 'match' : 'mismatch';
        }
        return 'match';
    }

    /** Linux 는 실행 중에 바꾼(업그레이드) 실행 파일의 경로에 " (deleted)" 를 붙인다. 비교할 때는 뗀다. */
    public static normalizeExePath(exe: string): string {
        return exe.replace(/ \(deleted\)$/, '');
    }

    private static samePath(a: string, b: string): boolean {
        const left = Path.resolve(Sentinel.normalizeExePath(a));
        const right = Path.resolve(Sentinel.normalizeExePath(b));
        return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
    }

    /** 프로세스의 시작 시각과 실행 파일을 OS 에 묻는다(#256). 없거나 알 수 없으면 undefined. */
    public static processIdentity(pid: number): ProcessIdentity | undefined {
        if(!Number.isSafeInteger(pid) || pid <= 0) return undefined;
        try {
            if(process.platform === 'linux') return Sentinel.linuxProcessIdentity(pid);
            if(process.platform === 'win32') return Sentinel.windowsProcessIdentity(pid);
        } catch (e) {
            logger.debug(`processIdentity(${pid}) failed: ${(e as Error).message}`);
        }
        return undefined;
    }

    private static linuxProcessIdentity(pid: number): ProcessIdentity | undefined {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
        // comm(2번째 필드)에 공백·괄호가 들어갈 수 있으므로 마지막 ')' 뒤부터 센다. 그 뒤 20번째가 starttime(22번째 필드)이다.
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        const startTicks = Number(fields[19]);
        const bootLine = fs.readFileSync('/proc/stat', 'utf-8').split('\n').find((line) => line.startsWith('btime '));
        const bootSeconds = bootLine ? Number(bootLine.split(/\s+/)[1]) : NaN;
        // USER_HZ 는 Linux 에서 100 이다. start 는 참고용이고 비교는 ticks 로 한다(btime 은 시계 보정에 따라 움직인다).
        const start = Number.isFinite(startTicks) && Number.isFinite(bootSeconds) ? (bootSeconds + startTicks / 100) * 1000 : undefined;
        let exe: string | undefined;
        try { exe = fs.readlinkSync(`/proc/${pid}/exe`); } catch { exe = undefined; }
        let cmdline: string[] | undefined;
        try { cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8').split('\0').filter((part) => part !== ''); } catch { cmdline = undefined; }
        return {start, ticks: Number.isFinite(startTicks) ? startTicks : undefined, exe, cmdline};
    }

    /** PATH 를 줄인 환경(서비스 등)에서도 찾도록 시스템 폴더의 PowerShell 을 먼저 쓴다. */
    private static powershellPath(): string {
        const systemPowerShell = Path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        return fs.existsSync(systemPowerShell) ? systemPowerShell : 'powershell.exe';
    }

    private static windowsProcessIdentity(pid: number): ProcessIdentity | undefined {
        // WMI 를 거치지 않는 Get-Process 를 쓴다(#207: WMI 조회는 멈출 수 있다). 기한을 둔다.
        // 출력은 UTF-8 로 받는다(기본은 OEM 코드페이지라 비ASCII 경로가 깨진다). 시작 시각은 UTC 로 바꿔 DST 경계의 모호함을 피한다.
        // 권한이 없는 프로세스는 StartTime 이 null 이다. 그때는 시작 시각을 비워 보낸다(PowerShell 실패와 구별된다).
        const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
            `if($p) { $s = if($p.StartTime) { [DateTimeOffset]::new($p.StartTime.ToUniversalTime(), [TimeSpan]::Zero).ToUnixTimeMilliseconds() } else { '' }; ` +
            `'{0}|{1}' -f $s, $p.Path }`;
        const result = spawnSync(Sentinel.powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', script],
            {encoding: 'utf-8', timeout: IDENTITY_QUERY_TIMEOUT_MS, windowsHide: true});
        if(result.error || (result.status !== 0 && result.status !== null)) {
            logger.warn(`Could not query process ${pid} with PowerShell: ${result.error?.message ?? `exit ${result.status}`}`);
            return undefined;
        }
        const line = (result.stdout ?? '').trim();
        // 출력이 없으면 그 PID 의 프로세스가 없다(이미 끝났다).
        if(line === '') return undefined;
        const separator = line.indexOf('|');
        const startText = line.slice(0, separator).trim();
        const start = startText === '' ? NaN : Number(startText);
        const exe = line.slice(separator + 1).trim();
        return {start: Number.isFinite(start) ? start : undefined, exe: exe === '' ? undefined : exe};
    }

    public static stop() {
        // sentinel 을 먼저 끝낸다. app 을 먼저 끝내면, 확인(Windows 는 PowerShell 조회)에 걸리는 사이 sentinel 이 app 을 다시 띄울 수 있다(#256).
        Sentinel.processKill('sentinel');
        Sentinel.processKill('app');
        Sentinel.processKill('foreground');
    }




    private boot() {
        // #207 REQ-6: 이전 실행의 설정 오류 표시가 남아 있으면 고친 설정으로 다시 띄워도 sentinel 이 바로 끝난다.
        clearConfigErrorMarker();
        let appPID = Sentinel.readPIDFile('app');
        let sentinelPID = Sentinel.readPIDFile('sentinel');
        let foregroundPID = Sentinel.readPIDFile('foreground');
        if(sentinelPID.length > 0) {
            logger.warn('Already running sentinel pid:' + sentinelPID.map((entry) => entry.pid));
            Sentinel.processKill('sentinel');
            if(appPID.length > 0) {
                logger.warn('Already running app killed. pid:' + appPID.map((entry) => entry.pid));
                Sentinel.processKill('app');
            }
            if(foregroundPID.length > 0) {
                logger.warn('Already running foreground. pid:' + foregroundPID.map((entry) => entry.pid));
                Sentinel.processKill('foreground');
            }
            this.startIfNoUnconfirmedDaemon();

        } else {
            Sentinel.processKill('app');
            Sentinel.processKill('foreground');
            this.startIfNoUnconfirmedDaemon();
        }
    }

    private static deletePIDFile(type: PidType) {
        let path = Path.join(Environment.path.binDir, `.pid_${type}`);
        try {
            if(fs.existsSync(path)) {
                fs.unlinkSync(path);
            }
        } catch (e) {
            Sentinel.reportPidFileError(path, e);
        }
    }

    /** PID 파일을 읽고 쓰지 못했다(권한 등). 예외로 끝나지 않고 경로와 이유를 남긴 뒤 실패 코드로 끝나게 한다(#256). */
    private static reportPidFileError(path: string, error: unknown) {
        logger.error(`Cannot use the pid file ${path}: ${(error as Error).message}. Check that this user can read and write ${Path.dirname(path)}.`);
        process.exitCode = 1;
    }

    /**
     * 확인하지 못해 남긴 sentinel·app 이 아직 살아 있으면 새 쌍을 띄우지 않는다(#256).
     * 띄우면 데몬이 둘이 되어 포트가 부딪친다.
     */
    private startIfNoUnconfirmedDaemon() {
        // 다른 사용자의 프로세스인데 확인할 수 없는 항목은 막지 않는다(재사용된 PID 일 수 있다). 다만 알린다.
        // Windows 는 관리자로 띄운 프로세스의 정보를 일반 사용자에게 주지 않으므로, 데몬을 띄운 사용자와 같은 권한으로 멈추고 띄워야 한다.
        for(const type of ['sentinel', 'app', 'foreground'] as PidType[]) {
            for(const entry of Sentinel.readPIDFile(type)) {
                if(entry.pid == process.pid || Sentinel.processState(entry.pid) !== 'eperm') continue;
                if(Sentinel.matchRecordedProcess(entry) !== 'unknown') continue;
                logger.warn(`${type} pid ${entry.pid} (${Path.join(Environment.path.binDir, `.pid_${type}`)}) may be TTTGate running as another user; ` +
                    'starting a new pair anyway. Stop and start TTTGate as the same user.');
            }
        }
        // foreground 서버도 본다. 살아 있으면 새 데몬과 포트가 부딪친다.
        const remaining = (['sentinel', 'app', 'foreground'] as PidType[]).flatMap((type) =>
            Sentinel.liveEntries(type).map((entry) => `pid ${entry.pid} (${Path.join(Environment.path.binDir, `.pid_${type}`)})`));
        if(remaining.length > 0) {
            logger.error(`A previous TTTGate process is still running and was not stopped: ${remaining.join(', ')}. ` +
                'Stop it (as the user that started it), then start again. If that pid is not TTTGate, delete the pid file and start again.');
            process.exitCode = 1;
            return;
        }
        this.startAllProcess();
    }

    private startAllProcess() {
        logger.info('Start daemon and sentinel mode.');
        this.startApp((pid) => {
            logger.info('App started: ' + pid);
            Sentinel.writeSpawnedPid(pid, 'app');
            this.startSentinel(pid, (pid) => {
                logger.info('Sentinel started: ' + pid);
                Sentinel.writeSpawnedPid(pid, 'sentinel');
            });
        });
    }



    /** PID 파일의 항목들. 새 형식(JSON 한 줄)과 예전 형식(숫자만)을 모두 읽는다(#256). */
    private static readPIDFile(type: PidType) : Array<PidEntry> {
        let path = Path.join(Environment.path.binDir, `.pid_${type}`);
        let text: string;
        try {
            if(!fs.existsSync(path)) return [];
            text = fs.readFileSync(path).toString();
        } catch (e) {
            Sentinel.reportPidFileError(path, e);
            return [];
        }
        let result : Array<PidEntry> = [];
        for(let item of text.split('\n')) {
            item = item.trim();
            if(item == '') continue;
            if(item.startsWith('{')) {
                try {
                    const parsed = JSON.parse(item) as Record<string, unknown>;
                    const pid = parsed.pid;
                    if(typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) continue;
                    // 형식이 맞지 않는 필드는 버린다. 버리면 확인이 더 엄격한 쪽(예전 형식 규칙)으로 간다.
                    const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
                    result.push({pid, start: finite(parsed.start), ticks: finite(parsed.ticks),
                        exe: typeof parsed.exe === 'string' ? parsed.exe : undefined});
                } catch { /* 깨진 줄은 건너뛴다 */ }
                continue;
            }
            let pid = parseInt(item);
            if(!isNaN(pid) && pid > 0) result.push({pid});
        }
        return result;
    }

    /**
     * PID 파일을 이 항목 하나로 덮어쓴다(#256). 예전에는 덧붙여 재시작할 때마다 옛 PID 가 쌓였고,
     * stop 이 그 옛 PID(다른 프로그램이 다시 쓰고 있을 수 있다)까지 끝냈다.
     */
    private static writePidEntry(entry: PidEntry, type: PidType) {
        Sentinel.writePidEntries([entry], type);
    }

    private static writePidEntries(entries: PidEntry[], type: PidType) {
        const path = Path.join(Environment.path.binDir, `.pid_${type}`);
        try {
            fs.writeFileSync(path, entries.map((entry) => JSON.stringify(entry) + '\n').join(''), {encoding: 'utf-8'});
        } catch (e) {
            Sentinel.reportPidFileError(path, e);
        }
    }

    /**
     * 방금 띄운 자식의 PID 를 적는다. 시작 시각은 spawn 시각으로 적는다(실제와 수 ms 차이).
     * Linux 는 /proc 의 시작 tick 도 적는다(값싼 파일 읽기다. Windows 는 PowerShell 조회가 무거워 시각만 적는다).
     */
    private static writeSpawnedPid(pid: number, type: PidType) {
        const ticks = process.platform === 'linux' ? Sentinel.processIdentity(pid)?.ticks : undefined;
        Sentinel.writePidEntry({pid, start: Date.now(), ticks}, type);
    }

    /** 신호 0 으로 PID 가 살아 있는지 본다. EPERM 은 살아 있지만 권한이 없는 경우다. */
    public static isProcessAlive(pid: number): boolean {
        // sentinel 이 지켜보는 것은 자기가 띄운 같은 사용자의 app 이다. EPERM 이면 그 PID 를 다른 사용자가 다시 쓰고 있으므로
        // app 은 이미 없다(예전에는 살아 있다고 보아 다시 띄우지 않았다)(#256).
        return Sentinel.processState(pid) === 'alive';
    }

    /** 앱이 사라졌을 때 다시 띄울지(#207). 앱이 설정 오류 표시를 남겼으면 띄우지 않는다. */
    public static shouldRestartApp(): boolean {
        return !hasConfigErrorMarker();
    }

    public runSentinel() {
        this.startScanPid(parseInt(process.env.APP_PID!));
    }

    private restartApp() {
        this.startApp((pid) => {
            Sentinel.writeSpawnedPid(pid, 'app');
            this.startScanPid(pid);
        });
    }

    private startScanPid(pid: number) {
        let intervalID = setInterval(() => {
            // PID 가 살아 있는지만 본다. 프로세스 표 조회(find-process)는 Windows 에서 WMI 를 거쳐 멈출 수 있다(#207).
            Promise.resolve(Sentinel.isProcessAlive(pid)).then((alive: boolean) => {
                if(!alive) {
                    logger.warn('App not found. pid:' + pid);
                    clearInterval(intervalID);
                    if(!Sentinel.shouldRestartApp()) {
                        // #207 REQ-5: 설정 오류로 끝난 앱은 다시 띄워도 같은 오류로 끝난다. PID 파일을 지우고 멈춘다.
                        logger.error('App stopped with a configuration error. Not restarting. Fix the configuration and start again.');
                        Sentinel.deletePIDFile('app');
                        Sentinel.deletePIDFile('sentinel');
                        LoggerFactory.flush().finally(() => process.exit(0));
                        return;
                    }
                    setTimeout(() => {
                        logger.info('Restart app');
                        this.restartApp();
                    }, 3000);
                }
            }).catch((err: any) => {
                logger.error('Error on find process: ' + pid, err);
                logger.info('Stop sentinel')
                clearInterval(intervalID);
                process.exit(1);
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

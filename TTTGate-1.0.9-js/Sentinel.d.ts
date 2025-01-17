declare class Sentinel {
    private _executePath;
    private _argvList;
    private _argv;
    static isDaemonMode(): boolean;
    static hasExecuteMode(): boolean;
    static isSentinelMode(): boolean;
    static create(devMode: boolean): Sentinel;
    private makeDevPathList;
    private makeRuntimePathList;
    constructor();
    /**
     * Start sentinel
     * @returns true 면 boot 혹은 sentinel 프로세스 밖에서 바로 true 해야함., false 면 부모 프로세스
     */
    start(): boolean;
    private runApp;
    private static writeForegroundPID;
    private static processKill;
    static stop(): void;
    private boot;
    private static deletePIDFile;
    private startAllProcess;
    private static readPIDFile;
    private static writePidFile;
    runSentinel(): void;
    private restartApp;
    private startScanPid;
    private startSentinel;
    private startApp;
    private exec;
}
export default Sentinel;

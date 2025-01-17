interface NetworkInterface {
    address: string;
    netmask: string;
    family: string;
    mac: string;
    internal: boolean;
    cidr: string;
}
interface NetworkInfo {
    [name: string]: Array<NetworkInterface>;
}
interface Usage {
    memory: {
        free: number;
        total: number;
        process: number;
    };
    cpu: {
        total: number;
        process: number;
    };
    uptime: number;
    heap: {
        used: number;
        total: number;
    };
    totalBuffer: {
        used: number;
        total: number;
    };
}
interface SysInfo {
    osInfo: {
        platform: string;
        release: string;
        type: string;
        hostname: string;
    };
    ram: number;
    cpuInfo: {
        model: string;
        speed: number;
        cores: number;
    };
    network: NetworkInfo;
}
declare class SysMonitor {
    private static _instance;
    private static readonly _startTime;
    private prevCpuInfo;
    private _lastUsage;
    private _sysInfoCache;
    private _lastUsageReadTime;
    private constructor();
    static get instance(): SysMonitor;
    private cpuUsage;
    usage(): Promise<Usage>;
    sysInfo(): Promise<SysInfo>;
}
export { SysMonitor, SysInfo };

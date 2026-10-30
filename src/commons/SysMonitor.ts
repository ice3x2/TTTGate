import pidusage from "pidusage";
import {SocketHandler} from "../util/SocketHandler";
import os, {NetworkInterfaceInfo} from "os";
import ExMath from "../util/ExMath";
import LoggerFactory from "../util/logger/LoggerFactory";
import Dict = NodeJS.Dict;



interface NetworkInterface {
    address: string;
    netmask: string;
    family: string;
    mac: string;
    internal: boolean;
    cidr: string;
}

interface NetworkInfo {
    [name: string] : Array<NetworkInterface>;
}

interface Usage {
    memory: {
        free: number;
        total: number;
        process: number;
    },
    cpu: {
        total: number
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
    },
    ram: number,
    cpuInfo : {
        model: string;
        speed: number;
        cores: number;
    },
    network : NetworkInfo;
}

const logger = LoggerFactory.getLogger("default", "SysMonitor");

/** pidusage 가 기한 안에 끝나지 않았음을 나타낸다. */
const PROBE_TIMED_OUT = Symbol("probe-timed-out");

class SysMonitor {

    /**
     * #252: 사용량 조회(pidusage)의 기한(ms). pidusage 는 자식 프로세스(Windows wmic)에 기한을 두지 않으므로,
     * 멈추면 조회가 끝나지 않는다. 테스트에서 줄일 수 있다.
     */
    public static usageTimeoutMs: number = 5000;

    private static _instance: SysMonitor;
    private static readonly _startTime: number = Date.now();
    private prevCpuInfo = os.cpus();

    private _lastUsage : Usage | null = null;
    private _sysInfoCache : SysInfo | null = null;
    private _lastUsageReadTime : number = 0;
    /** #252: 진행 중인 조회. 있으면 새 조회를 시작하지 않고 그 결과를 함께 쓴다. */
    private _usageInFlight : Promise<Usage> | undefined;
    /**
     * #252: 아직 끝나지 않은 pidusage 호출. 기한을 넘겨도 pidusage 는 자식 프로세스를 멈추지 않으므로,
     * 이것이 끝나기 전에는 새로 부르지 않는다. 그러지 않으면 멈춘 자식이 기한마다 하나씩 쌓인다.
     */
    private _pendingProbe : Promise<pidusage.Status> | undefined;
    /** 멈춘 pidusage 호출을 이미 알렸는지. 그 호출이 끝나면 되돌린다. */
    private _probeStuckLogged : boolean = false;

    private constructor() {

    }

    public static get instance() : SysMonitor {
        if(!SysMonitor._instance) {
            SysMonitor._instance = new SysMonitor();
        }
        return SysMonitor._instance;
    }


    private cpuUsage() {
        const currentCpuInfo = os.cpus();
        let totalDelta = 0;
        let idleDelta = 0;

        currentCpuInfo.forEach((currentCore, i) => {
            const prevCore = this.prevCpuInfo[i];
            const totalDiff = (
                currentCore.times.user +
                currentCore.times.nice +
                currentCore.times.sys +
                currentCore.times.irq +
                currentCore.times.idle
            ) - (
                prevCore.times.user +
                prevCore.times.nice +
                prevCore.times.sys +
                prevCore.times.irq +
                prevCore.times.idle
            );

            const idleDiff = currentCore.times.idle - prevCore.times.idle;

            totalDelta += totalDiff;
            idleDelta += idleDiff;
        });

        const cpuUsage = ((totalDelta - idleDelta) / totalDelta) * 100;
        this.prevCpuInfo = currentCpuInfo;
        return ExMath.round(cpuUsage,1);
    }


    public async usage() : Promise<Usage> {
        if(this._lastUsage && Date.now() - this._lastUsageReadTime < 500) {
            return this._lastUsage;
        }
        if(this._usageInFlight) {
            return this._usageInFlight;
        }
        const inFlight = this.readUsage().finally(() => {
            if(this._usageInFlight === inFlight) this._usageInFlight = undefined;
        });
        this._usageInFlight = inFlight;
        return inFlight;
    }

    /**
     * pidusage 를 기한 안에서 기다린다. 기한을 넘기면 PROBE_TIMED_OUT 이다. 실패는 그대로 던진다.
     * 앞서 기한을 넘긴 호출이 아직 끝나지 않았으면 기다리지 않고 바로 PROBE_TIMED_OUT 이다.
     */
    private async probeProcess() : Promise<pidusage.Status | typeof PROBE_TIMED_OUT> {
        if(this._pendingProbe) return PROBE_TIMED_OUT;
        const probe = pidusage(process.pid);
        this._pendingProbe = probe;
        probe.then(() => undefined, () => undefined).finally(() => {
            if(this._pendingProbe !== probe) return;
            this._pendingProbe = undefined;
            this._probeStuckLogged = false;
        });
        let timer: NodeJS.Timeout | undefined;
        const deadline = new Promise<typeof PROBE_TIMED_OUT>((resolve) => {
            timer = setTimeout(() => resolve(PROBE_TIMED_OUT), SysMonitor.usageTimeoutMs);
            timer.unref?.();
        });
        try {
            return await Promise.race([probe, deadline]);
        } finally {
            clearTimeout(timer);
        }
    }

    private async readUsage() : Promise<Usage> {
        this._lastUsageReadTime = Date.now();
        let cpu = 0;
        let uptime = Date.now() - SysMonitor._startTime;
        let memory = process.memoryUsage().rss;


        try {
            const stat = await this.probeProcess();
            if(stat === PROBE_TIMED_OUT) {
                if(!this._probeStuckLogged) {
                    this._probeStuckLogged = true;
                    logger.warn(`Process usage query did not finish within ${SysMonitor.usageTimeoutMs}ms; showing the last process CPU and memory until it finishes.`);
                }
                // 기한을 넘겼다. 조회에서 오는 두 값만 지난 값(없으면 조회 없이 잰 값)을 쓰고, 나머지는 새로 잰다.
                cpu = this._lastUsage?.cpu.process ?? cpu;
                memory = this._lastUsage?.memory.process ?? memory;
            } else {
                cpu = stat.cpu;
                let coreInfos = os.cpus();
                if(coreInfos.length > 1) {
                    cpu = cpu / coreInfos.length;
                }
                cpu = ExMath.round(cpu, 1);
                memory = stat.memory;
            }
        } catch (ignored) {}
        let currentUsage : Usage = {
            cpu: {
                total: this.cpuUsage(),
                process:  cpu
            },
            uptime: uptime,
            memory: {
                free: os.freemem(),
                total: os.totalmem(),
                process: memory
            },
            heap: {
                used: process.memoryUsage().heapUsed,
                total: process.memoryUsage().heapTotal
            },
            totalBuffer: {
                used: SocketHandler.globalMemoryBufferSize,
                total: SocketHandler.maxGlobalMemoryBufferSize
            }
        };
        this._lastUsage = currentUsage;
        return currentUsage;
    }


    public async sysInfo() : Promise<SysInfo> {
        if(this._sysInfoCache) {
            return this._sysInfoCache;
        }
        let network : Dict<NetworkInterfaceInfo[]> | {[name: string] : Array<NetworkInterface>} = {};
        try {
            network = os.networkInterfaces();
        }
        catch (e) {
            network = {unknown: []}
        }
        let keys =  Object.keys(network);
        let networkInfo : NetworkInfo = {};
        keys.forEach((key) => {
            let info = network[key] as NetworkInterfaceInfo[];
            networkInfo[key] = [];
            info.forEach((item) => {
                networkInfo[key].push({
                    address: item.address,
                    netmask: item.netmask,
                    family: item.family,
                    mac: item.mac,
                    internal: item.internal,
                    cidr: item.cidr ?? ''
                });
            });
        });

        // 일부 환경(컨테이너·제한된 /proc)에서는 os.cpus() 가 빈 배열이다(#164).
        const cpus = os.cpus();
        let status : SysInfo = {
            cpuInfo: {
                model: cpus[0]?.model ?? 'unknown',
                speed: cpus[0]?.speed ?? 0,
                cores: cpus.length,
            },
            ram: os.totalmem(),
            osInfo: {
                platform: os.platform(),
                release: os.release(),
                type: os.type(),
                hostname: os.hostname()
            },
            network: networkInfo
        };

        this._sysInfoCache = status;

        return status;
    }





}

export { SysMonitor , SysInfo};
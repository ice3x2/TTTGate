import pidusage from "pidusage";
import {SocketHandler} from "../util/SocketHandler";
import os, {NetworkInterfaceInfo} from "os";
import ExMath from "../util/ExMath";
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

class SysMonitor {

    private static _instance: SysMonitor;
    private static readonly _startTime: number = Date.now();
    private prevCpuInfo = os.cpus();

    private _lastUsage : Usage | null = null;
    private _sysInfoCache : SysInfo | null = null;
    private _lastUsageReadTime : number = 0;

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
        this._lastUsageReadTime = Date.now();
        let cpu = 0;
        let uptime = Date.now() - SysMonitor._startTime;
        let memory = process.memoryUsage().rss;


        try {
            const stat = await pidusage(process.pid);
            cpu = stat.cpu;
            let coreInfos = os.cpus();
            if(coreInfos.length > 1) {
                cpu = cpu / coreInfos.length;
            }
            cpu = ExMath.round(cpu, 1);
            memory = stat.memory;
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
        let network : Dict<NetworkInterfaceInfo[]> =  os.networkInterfaces();
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
        let status : SysInfo = {
            cpuInfo: {
                model: os.cpus()[0].model,
                speed: os.cpus()[0].speed,
                cores: os.cpus().length,
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
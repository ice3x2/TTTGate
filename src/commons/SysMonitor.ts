import pidusage from "pidusage";
import {SocketHandler} from "../util/SocketHandler";
import os, {NetworkInterfaceInfo} from "os";
import ExMath from "../util/ExMath";
import Dict = NodeJS.Dict;
import net from "net";

interface SysStatus {
    cpuInfo : {
        model: string;
        speed: number;
        cores: number;
    },
    osInfo: {
        platform: string;
        release: string;
        type: string;
        hostname: string;
    },
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

class SysMonitor {

    private static _instance: SysMonitor;
    private readonly _startTime: number = Date.now();
    private prevCpuInfo = os.cpus();

    private _lastStatus : SysStatus | null = null;
    private _lastStatusTime : number = 0;

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


    public async status() : Promise<SysStatus> {
        if(this._lastStatus && Date.now() - this._lastStatusTime < 500) {
            return this._lastStatus;
        }
        this._lastStatusTime = Date.now();
        let cpu = 0;
        let uptime = Date.now() - this._startTime;
        let memory = process.memoryUsage().rss;
        let network : Dict<NetworkInterfaceInfo[]> =  os.networkInterfaces();
        let keys =  Object.keys(network);
        keys.forEach((key) => {
            let info = network[key] as NetworkInterfaceInfo[];
            //info.forEach()


        });
        try {

            const stat = await pidusage(process.pid);
            cpu = stat.cpu;
            memory = stat.memory;
        } catch (ignored) {}
        let status= {
            cpuInfo: {
                model: os.cpus()[0].model,
                speed: os.cpus()[0].speed,
                cores: os.cpus().length,


            },

            osInfo: {
                platform: os.platform(),
                release: os.release(),
                type: os.type(),
                hostname: os.hostname()
            },
            cpu: {
                total: this.cpuUsage(),
                process: cpu
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
        }

        this._lastStatus = status;

        return status;
    }





}

export { SysMonitor , SysStatus};
import pidusage from "pidusage";
import {SocketHandler} from "../util/SocketHandler";
import os from "os";
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
    cpu: number;
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


    private constructor() {

    }

    public static get instance() : SysMonitor {
        if(!SysMonitor._instance) {
            SysMonitor._instance = new SysMonitor();
        }
        return SysMonitor._instance;
    }


    public async status() : Promise<SysStatus> {
        let cpu = 0;
        let uptime = Date.now() - this._startTime;
        let memory = process.memoryUsage().rss;
        try {
            const stat = await pidusage(process.pid);
            cpu = stat.cpu;
            memory = stat.memory;
        } catch (ignored) {}
        return {
            cpuInfo: {
                model: os.cpus()[0].model,
                speed: os.cpus()[0].speed,
                cores: os.cpus().length
            },

            osInfo: {
                platform: os.platform(),
                release: os.release(),
                type: os.type(),
                hostname: os.hostname()
            },
            cpu: cpu,
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
    }





}

export { SysMonitor , SysStatus};
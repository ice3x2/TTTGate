"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SysMonitor = void 0;
const pidusage_1 = __importDefault(require("pidusage"));
const SocketHandler_1 = require("../util/SocketHandler");
const os_1 = __importDefault(require("os"));
const ExMath_1 = __importDefault(require("../util/ExMath"));
class SysMonitor {
    static _instance;
    static _startTime = Date.now();
    prevCpuInfo = os_1.default.cpus();
    _lastUsage = null;
    _sysInfoCache = null;
    _lastUsageReadTime = 0;
    constructor() {
    }
    static get instance() {
        if (!SysMonitor._instance) {
            SysMonitor._instance = new SysMonitor();
        }
        return SysMonitor._instance;
    }
    cpuUsage() {
        const currentCpuInfo = os_1.default.cpus();
        let totalDelta = 0;
        let idleDelta = 0;
        currentCpuInfo.forEach((currentCore, i) => {
            const prevCore = this.prevCpuInfo[i];
            const totalDiff = (currentCore.times.user +
                currentCore.times.nice +
                currentCore.times.sys +
                currentCore.times.irq +
                currentCore.times.idle) - (prevCore.times.user +
                prevCore.times.nice +
                prevCore.times.sys +
                prevCore.times.irq +
                prevCore.times.idle);
            const idleDiff = currentCore.times.idle - prevCore.times.idle;
            totalDelta += totalDiff;
            idleDelta += idleDiff;
        });
        const cpuUsage = ((totalDelta - idleDelta) / totalDelta) * 100;
        this.prevCpuInfo = currentCpuInfo;
        return ExMath_1.default.round(cpuUsage, 1);
    }
    async usage() {
        if (this._lastUsage && Date.now() - this._lastUsageReadTime < 500) {
            return this._lastUsage;
        }
        this._lastUsageReadTime = Date.now();
        let cpu = 0;
        let uptime = Date.now() - SysMonitor._startTime;
        let memory = process.memoryUsage().rss;
        try {
            const stat = await (0, pidusage_1.default)(process.pid);
            cpu = stat.cpu;
            let coreInfos = os_1.default.cpus();
            if (coreInfos.length > 1) {
                cpu = cpu / coreInfos.length;
            }
            cpu = ExMath_1.default.round(cpu, 1);
            memory = stat.memory;
        }
        catch (ignored) { }
        let currentUsage = {
            cpu: {
                total: this.cpuUsage(),
                process: cpu
            },
            uptime: uptime,
            memory: {
                free: os_1.default.freemem(),
                total: os_1.default.totalmem(),
                process: memory
            },
            heap: {
                used: process.memoryUsage().heapUsed,
                total: process.memoryUsage().heapTotal
            },
            totalBuffer: {
                used: SocketHandler_1.SocketHandler.globalMemoryBufferSize,
                total: SocketHandler_1.SocketHandler.maxGlobalMemoryBufferSize
            }
        };
        this._lastUsage = currentUsage;
        return currentUsage;
    }
    async sysInfo() {
        if (this._sysInfoCache) {
            return this._sysInfoCache;
        }
        let network = {};
        try {
            network = os_1.default.networkInterfaces();
        }
        catch (e) {
            network = { unknown: [] };
        }
        let keys = Object.keys(network);
        let networkInfo = {};
        keys.forEach((key) => {
            let info = network[key];
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
        let status = {
            cpuInfo: {
                model: os_1.default.cpus()[0].model,
                speed: os_1.default.cpus()[0].speed,
                cores: os_1.default.cpus().length,
            },
            ram: os_1.default.totalmem(),
            osInfo: {
                platform: os_1.default.platform(),
                release: os_1.default.release(),
                type: os_1.default.type(),
                hostname: os_1.default.hostname()
            },
            network: networkInfo
        };
        this._sysInfoCache = status;
        return status;
    }
}
exports.SysMonitor = SysMonitor;

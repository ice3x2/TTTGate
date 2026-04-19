import fs from "fs";
import Path from "path";
import Environment from "../../src/Environment";
import {SocketHandler} from "../../src/util/SocketHandler";

type ResourceStats = {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    fdCount: number;
    activeHandles: number;
    serverCacheBytes: number;
    clientCacheBytes: number;
    socketGlobalBufferedBytes: number;
    socketGlobalFileCacheBytes: number;
}

const bytesToMb = (bytes: number): number => {
    return Math.round((bytes / 1024 / 1024) * 100) / 100;
};

const countDirectoryBytes = (directoryPath: string): number => {
    if(!fs.existsSync(directoryPath)) {
        return 0;
    }

    const walk = (targetPath: string): number => {
        const stat = fs.statSync(targetPath);
        if(stat.isFile()) {
            return stat.size;
        }
        if(!stat.isDirectory()) {
            return 0;
        }
        return fs.readdirSync(targetPath).reduce((total, child) => {
            return total + walk(Path.join(targetPath, child));
        }, 0);
    };

    return walk(directoryPath);
};

const countFd = (): number => {
    try {
        return fs.readdirSync("/proc/self/fd").length;
    } catch {
        const handles = (process as any)._getActiveHandles?.();
        return Array.isArray(handles) ? handles.length : -1;
    }
};

const collectResourceStats = (): ResourceStats => {
    const memoryUsage = process.memoryUsage();
    const handles = (process as any)._getActiveHandles?.();

    return {
        rssMb: bytesToMb(memoryUsage.rss),
        heapUsedMb: bytesToMb(memoryUsage.heapUsed),
        heapTotalMb: bytesToMb(memoryUsage.heapTotal),
        fdCount: countFd(),
        activeHandles: Array.isArray(handles) ? handles.length : -1,
        serverCacheBytes: countDirectoryBytes(Environment.path.serverCacheDir),
        clientCacheBytes: countDirectoryBytes(Environment.path.clientCacheDir),
        socketGlobalBufferedBytes: SocketHandler.globalMemoryBufferSize,
        socketGlobalFileCacheBytes: SocketHandler.globalFileCacheSize
    };
};

export { collectResourceStats, ResourceStats };

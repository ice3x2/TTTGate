import os from "os";
import {SysMonitor} from "../../../src/commons/SysMonitor";

describe("SysMonitor", () => {
    test("instance is a singleton", () => {
        expect(SysMonitor.instance).toBe(SysMonitor.instance);
    });

    test("usage() reports plausible live values", async () => {
        // Warm-up call primes the internal CPU-tick snapshot regardless of what
        // earlier tests already did with the singleton. cpuUsage() derives cpu.total
        // from the tick delta between this snapshot and the next one; if that gap is
        // too small (e.g. right after the singleton was just constructed, on a low
        // timer-resolution host) the delta can be 0/0 = NaN. Waiting a real 600ms
        // (well past the 500ms usage() cache window and far past OS timer
        // resolution) before the asserted call makes the delta deterministic.
        await SysMonitor.instance.usage();
        await new Promise((resolve) => setTimeout(resolve, 600));

        const usage = await SysMonitor.instance.usage();
        expect(usage.cpu.total).toBeGreaterThanOrEqual(0);
        expect(usage.cpu.total).toBeLessThanOrEqual(100);
        expect(usage.cpu.process).toBeGreaterThanOrEqual(0);
        expect(usage.cpu.process).toBeLessThanOrEqual(100);
        expect(usage.memory.total).toBeGreaterThan(0);
        expect(usage.memory.free).toBeGreaterThanOrEqual(0);
        expect(usage.memory.process).toBeGreaterThan(0);
        expect(usage.heap.used).toBeLessThanOrEqual(usage.heap.total);
        expect(usage.totalBuffer.used).toBeGreaterThanOrEqual(0);
        expect(usage.uptime).toBeGreaterThanOrEqual(0);
    });

    test("usage() caches for 500ms then refreshes with an advanced uptime", async () => {
        const first = await SysMonitor.instance.usage();
        const second = await SysMonitor.instance.usage();
        expect(second).toBe(first);

        await new Promise((resolve) => setTimeout(resolve, 600));

        const third = await SysMonitor.instance.usage();
        expect(third).not.toBe(first);
        expect(third.uptime).toBeGreaterThan(first.uptime);
    });

    test("sysInfo() reports plausible live values and caches across calls", async () => {
        const info = await SysMonitor.instance.sysInfo();
        expect(info.cpuInfo.cores).toBeGreaterThanOrEqual(1);
        expect(typeof info.cpuInfo.model).toBe("string");
        expect(info.ram).toBeGreaterThan(0);
        expect(info.osInfo.platform).toBe(os.platform());
        expect(info.osInfo.hostname).toBe(os.hostname());
        expect(typeof info.network).toBe("object");
        expect(Object.keys(info.network).sort()).toEqual(Object.keys(os.networkInterfaces()).sort());

        const second = await SysMonitor.instance.sysInfo();
        expect(second).toBe(info);
    });
});

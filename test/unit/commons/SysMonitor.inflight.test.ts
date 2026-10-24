// #252 — 시스템 사용량 조회는 겹쳐 실행하지 않고, 끝나지 않는 조회에 묶이지 않는다.
jest.mock("pidusage", () => jest.fn());

type Monitor = {usage(): Promise<any>};

describe("SysMonitor usage in-flight and deadline (#252)", () => {
    let pidusage: jest.Mock;
    let SysMonitorClass: any;
    let monitor: Monitor;

    beforeEach(() => {
        jest.isolateModules(() => {
            pidusage = require("pidusage");
            SysMonitorClass = require("../../../src/commons/SysMonitor").SysMonitor;
        });
        monitor = SysMonitorClass.instance;
    });

    const hang = () => pidusage.mockImplementation(() => new Promise(() => {}));

    // REQ-1 / AC-1
    test("twenty concurrent calls start one probe", async () => {
        hang();
        SysMonitorClass.usageTimeoutMs = 200;
        const results = await Promise.all(Array.from({length: 20}, () => monitor.usage()));
        expect(pidusage).toHaveBeenCalledTimes(1);
        // 모두 같은 조회의 결과를 받는다.
        expect(new Set(results).size).toBe(1);
    });

    // REQ-2 / AC-2 — 끝나지 않는 조회는 기한 안에 값을 돌려준다. 마지막 값이 없으면 조회 없이 만든 값이다.
    test("a probe that never finishes returns within the deadline", async () => {
        hang();
        SysMonitorClass.usageTimeoutMs = 200;
        const started = Date.now();
        const usage = await monitor.usage();
        expect(Date.now() - started).toBeLessThan(200 + 1500);
        expect(usage.cpu.process).toBe(0);
        expect(usage.memory.process).toBeGreaterThan(0);
        expect(usage.memory.total).toBeGreaterThan(0);
    });

    // REQ-2 — 기한을 넘긴 조회가 아직 끝나지 않았으면 새 조회를 띄우지 않고 바로 돌려준다(멈춘 자식이 쌓이지 않게).
    // 그 조회가 끝난 뒤에야 다음 조회를 시작한다.
    test("while a timed-out probe is still pending the next call does not start another", async () => {
        let finish!: (value: unknown) => void;
        pidusage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        SysMonitorClass.usageTimeoutMs = 100;
        await monitor.usage();
        await new Promise((resolve) => setTimeout(resolve, 600));
        // 기한을 크게 올려도 기다리지 않고 바로 돌아와야 한다(멈춘 조회가 남아 있으므로 새로 기다리지 않는다).
        SysMonitorClass.usageTimeoutMs = 5000;
        const started = Date.now();
        await monitor.usage();
        expect(Date.now() - started).toBeLessThan(1000);
        expect(pidusage).toHaveBeenCalledTimes(1);
        finish({cpu: 5, memory: 777});
        await new Promise((resolve) => setTimeout(resolve, 600));
        pidusage.mockResolvedValueOnce({cpu: 6, memory: 888});
        const fresh = await monitor.usage();
        expect(pidusage).toHaveBeenCalledTimes(2);
        expect(fresh.memory.process).toBe(888);
    });

    // REQ-2 — 기한을 넘기면 마지막 값을 돌려준다.
    test("a timed-out probe returns the last usage when there is one", async () => {
        pidusage.mockResolvedValueOnce({cpu: 10, memory: 123_456});
        SysMonitorClass.usageTimeoutMs = 200;
        const first = await monitor.usage();
        expect(first.memory.process).toBe(123_456);
        await new Promise((resolve) => setTimeout(resolve, 600));
        hang();
        const second = await monitor.usage();
        // 조회에서 오는 값만 지난 값을 쓰고, 나머지는 새로 잰다.
        expect(second).not.toBe(first);
        expect(second.memory.process).toBe(first.memory.process);
        expect(second.cpu.process).toBe(first.cpu.process);
        expect(second.uptime).toBeGreaterThan(first.uptime);
    });

    // REQ-3 — 기본 기한은 5초다.
    test("the default deadline is five seconds", () => {
        expect(SysMonitorClass.usageTimeoutMs).toBe(5000);
    });
});

import {StatusPoller, type StatusSnapshot} from "../../admin/src/screens/parts/statusPoller";

// #338 REQ-10·REQ-14 — 터널 목록과 편집 화면이 함께 쓰는 상태 폴링(순수 TS, 가짜 시계).

class SessionOut extends Error {}

const snapshot = (serverTime: number): StatusSnapshot => ({serverTime, statuses: []});

/** 부를 때마다 끝나지 않은 약속을 하나 만들고, 테스트가 골라 끝낸다. */
const controllableLoad = () => {
    const calls: Array<{signal: AbortSignal; resolve: (value: StatusSnapshot) => void; reject: (error: unknown) => void}> = [];
    const load = (signal: AbortSignal) => new Promise<StatusSnapshot>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
        calls.push({signal, resolve, reject});
    });
    return {calls, load};
};

const setup = (overrides: {timeoutMs?: number} = {}) => {
    const {calls, load} = controllableLoad();
    const seen: number[] = [];
    const ticks: number[] = [];
    let failures = 0;
    let sessionOuts = 0;
    const poller = new StatusPoller({
        load, intervalMs: 1000, timeoutMs: overrides.timeoutMs ?? 5000, now: () => Date.now(),
        isSessionOut: (error) => error instanceof SessionOut,
        onSnapshot: (value) => { seen.push(value.serverTime); },
        onFailure: () => { failures++; },
        onSessionOut: () => { sessionOuts++; },
        onTick: (now) => { ticks.push(now); }
    });
    return {poller, calls, seen, ticks, failures: () => failures, sessionOuts: () => sessionOuts};
};

const flush = () => new Promise((resolve) => jest.requireActual<typeof import("timers")>("timers").setImmediate(resolve));

describe("StatusPoller", () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    test("시작하면 바로 읽고 주기마다 읽되, 앞의 읽기가 끝나지 않았으면 그 회차를 건너뛴다", async () => {
        const t = setup();
        t.poller.start();
        expect(t.calls).toHaveLength(1);
        jest.advanceTimersByTime(1000);
        expect(t.calls).toHaveLength(1);
        t.calls[0].resolve(snapshot(1));
        await flush();
        expect(t.seen).toEqual([1]);
        jest.advanceTimersByTime(1000);
        expect(t.calls).toHaveLength(2);
        t.poller.stop();
    });

    test("invalidate 앞에 시작한 읽기의 결과는 버린다", async () => {
        const t = setup();
        t.poller.start();
        t.poller.invalidate();
        t.calls[0].resolve(snapshot(1));
        await flush();
        expect(t.seen).toEqual([]);
        t.poller.stop();
    });

    test("refresh 는 진행 중인 읽기를 끊고 새로 읽으며, 그 읽기가 끝나야 돌아온다", async () => {
        const t = setup();
        t.poller.start();
        let done = false;
        const refreshed = t.poller.refresh().then(() => { done = true; });
        expect(t.calls[0].signal.aborted).toBe(true);
        expect(t.calls).toHaveLength(2);
        await flush();
        expect(done).toBe(false);
        t.calls[1].resolve(snapshot(2));
        await refreshed;
        expect(t.seen).toEqual([2]);
        // 끊긴 읽기는 실패로 세지 않는다.
        expect(t.failures()).toBe(0);
        t.poller.stop();
    });

    test("멈춘 읽기는 기한에 끊고 실패로 알린 뒤 다음 회차에 다시 읽는다", async () => {
        const t = setup({timeoutMs: 3000});
        t.poller.start();
        jest.advanceTimersByTime(3000);
        await flush();
        expect(t.calls[0].signal.aborted).toBe(true);
        expect(t.failures()).toBe(1);
        jest.advanceTimersByTime(1000);
        expect(t.calls).toHaveLength(2);
        t.poller.stop();
    });

    test("읽기가 멈춰 있어도 주기마다 onTick 을 부른다", () => {
        const t = setup();
        t.poller.start();
        jest.advanceTimersByTime(3000);
        expect(t.ticks).toHaveLength(3);
        t.poller.stop();
    });

    test("세션이 끝나면 멈추고 알린다", async () => {
        const t = setup();
        t.poller.start();
        t.calls[0].reject(new SessionOut());
        await flush();
        expect(t.sessionOuts()).toBe(1);
        jest.advanceTimersByTime(5000);
        expect(t.calls).toHaveLength(1);
    });

    test("멈춘 뒤에는 읽지 않고 늦게 온 결과도 버린다", async () => {
        const t = setup();
        t.poller.start();
        t.poller.stop();
        expect(t.calls[0].signal.aborted).toBe(true);
        jest.advanceTimersByTime(5000);
        expect(t.calls).toHaveLength(1);
        expect(t.seen).toEqual([]);
        expect(t.failures()).toBe(0);
    });
});

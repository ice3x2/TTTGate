import net from "node:net";
import {FREE_PORT_MAX, FREE_PORT_MIN, freePortRange, getFreePort} from "../../helpers/network";

// #197: 임시 포트 범위(Linux 32768–60999, Windows 49152–65535)의 번호를 미리 받아 두면, 서버를 열기 전에
// 다른 연결의 출발 포트로 쓰여 EADDRINUSE 가 난다. getFreePort 는 그 아래 범위에서 겹치지 않게 고른다.
describe("getFreePort", () => {
    const listen = (port: number) => new Promise<net.Server>((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen({port, host: "::"}, () => resolve(server));
    });
    const close = (server: net.Server) => new Promise<void>((resolve) => server.close(() => resolve()));

    test("picks ports below both OS ephemeral ranges and never repeats one in a file", async () => {
        const ports: number[] = [];
        for(let i = 0; i < 40; i++) ports.push(await getFreePort());
        for(const port of ports) {
            expect(port).toBeGreaterThanOrEqual(FREE_PORT_MIN);
            expect(port).toBeLessThan(FREE_PORT_MAX);
        }
        expect(FREE_PORT_MAX).toBeLessThanOrEqual(32768);
        expect(new Set(ports).size).toBe(ports.length);
    });

    test("returns a port the server can open on :: like the product listeners do", async () => {
        const server = await listen(await getFreePort());
        await close(server);
    });

    test("skips a port that is already in use", async () => {
        // getFreePort 를 거치지 않고 범위 끝에서 직접 점유한다(이미 내준 번호 검사와 섞이지 않게).
        const {min, max} = freePortRange(process.env.JEST_WORKER_ID, process.env.TTTGATE_JEST_WORKERS, process.env.TTTGATE_JEST_PORT_SHIFT);
        let busy = max - 1, holder: net.Server | undefined;
        for(; busy >= min && !holder; busy--) holder = await listen(busy).catch(() => undefined);
        busy++;
        if(!holder) throw new Error("no port to occupy in the free-port range");
        const random = jest.spyOn(Math, "random");
        try {
            // 첫 후보로 사용 중인 포트를 고르게 한 뒤 다음 후보는 다른 번호가 되게 한다.
            random.mockReturnValueOnce((busy - min) / (max - min));
            const next = await getFreePort();
            expect(next).not.toBe(busy);
            expect(next).toBeGreaterThanOrEqual(min);
            expect(next).toBeLessThan(max);
        } finally {
            random.mockRestore();
            await close(holder!);
        }
    });
});

// #262: handedOutPorts 는 워커 프로세스마다 따로 있다. 워커마다 범위를 나눠 서로 같은 포트를 받지 않게 한다.
describe("getFreePort across jest workers", () => {
    const saved = {id: process.env.JEST_WORKER_ID, count: process.env.TTTGATE_JEST_WORKERS};
    afterEach(() => {
        for(const [key, value] of [["JEST_WORKER_ID", saved.id], ["TTTGATE_JEST_WORKERS", saved.count]] as const) {
            if(value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    });

    // 워커 프로세스처럼 모듈을 새로 읽어 handedOutPorts 를 따로 갖게 한다.
    const portsOfWorker = async (id: string | undefined, count: string | undefined, n: number): Promise<number[]> => {
        if(id === undefined) delete process.env.JEST_WORKER_ID; else process.env.JEST_WORKER_ID = id;
        if(count === undefined) delete process.env.TTTGATE_JEST_WORKERS; else process.env.TTTGATE_JEST_WORKERS = count;
        let helper!: typeof import("../../helpers/network");
        jest.isolateModules(() => { helper = require("../../helpers/network"); });
        const ports: number[] = [];
        for(let i = 0; i < n; i++) ports.push(await helper.getFreePort());
        return ports;
    };

    // 이 흉내는 워커 수 2 로 전체 범위를 검사한다. 병렬 실행 중이면 다른 워커가 막 받은 포트를 잠깐 열어 볼 수 있다.
    // 열어 보는 시간이 짧고 #262 전에는 모든 워커가 그렇게 했으므로 받아들인다.
    test("two workers never receive the same port (AC-1)", async () => {
        const first = await portsOfWorker("1", "2", 200);
        const second = await portsOfWorker("2", "2", 200);
        const overlap = first.filter((port) => second.includes(port));
        expect(overlap).toEqual([]);
        expect(new Set(first).size).toBe(200);
        expect(new Set(second).size).toBe(200);
    }, 60_000);

    test("gives a port without a worker id (AC-2)", async () => {
        const [port] = await portsOfWorker(undefined, undefined, 1);
        expect(port).toBeGreaterThanOrEqual(FREE_PORT_MIN);
        expect(port).toBeLessThan(FREE_PORT_MAX);
    });

    test("splits the range into disjoint slices, one per worker", () => {
        const slices = Array.from({length: 31}, (_, i) => freePortRange(String(i + 1), "31"));
        for(const {min, max} of slices) {
            expect(min).toBeGreaterThanOrEqual(FREE_PORT_MIN);
            expect(max).toBeLessThanOrEqual(FREE_PORT_MAX);
            expect(max - min).toBeGreaterThanOrEqual(Math.floor((FREE_PORT_MAX - FREE_PORT_MIN) / 31));
        }
        for(let i = 1; i < slices.length; i++) expect(slices[i].min).toBeGreaterThanOrEqual(slices[i - 1].max);
    });

    test("uses the whole range with one worker or when the count or id is unknown (REQ-2)", () => {
        const whole = {min: FREE_PORT_MIN, max: FREE_PORT_MAX};
        expect(freePortRange("1", "1")).toEqual(whole);
        expect(freePortRange(undefined, "4")).toEqual(whole);
        expect(freePortRange("2", undefined)).toEqual(whole);
        expect(freePortRange("abc", "4")).toEqual(whole);
        expect(freePortRange("2", "0")).toEqual(whole);
    });

    // 전역 setup 이 넘긴 워커 수를 이 워커가 물려받았는지 본다. 없으면 범위가 나뉘지 않는다.
    test("this worker inherits the worker count from the global setup", () => {
        const count = Number(saved.count), id = Number(saved.id);
        expect(Number.isInteger(count) && count >= 1).toBe(true);
        expect(id).toBeGreaterThanOrEqual(1);
        expect(id).toBeLessThanOrEqual(count);
    });

    // 같은 머신에서 jest 를 여러 개 동시에 돌려도 k 번 워커끼리 늘 같은 조각을 쓰지 않도록 실행마다 밀어 둔다.
    test("a run shift moves the slices but keeps them disjoint", () => {
        const plain = Array.from({length: 4}, (_, i) => freePortRange(String(i + 1), "4"));
        const shifted = Array.from({length: 4}, (_, i) => freePortRange(String(i + 1), "4", "1"));
        expect(shifted[0]).toEqual(plain[1]);
        expect(shifted[3]).toEqual(plain[0]);
        expect(new Set(shifted.map(({min}) => min)).size).toBe(4);
        expect(freePortRange("1", "4", "x")).toEqual(plain[0]);
    });

    test("the global setup passes a shift inside the worker count", () => {
        const shift = Number(process.env.TTTGATE_JEST_PORT_SHIFT);
        expect(Number.isInteger(shift) && shift >= 0 && shift < Number(saved.count)).toBe(true);
    });

    // 워커가 아주 많아도 한 파일이 받는 포트(40개 테스트 포함)가 조각 안에 들어가야 한다.
    test("keeps every slice large enough when there are very many workers", () => {
        const {min, max} = freePortRange("100", "100");
        expect(max - min).toBeGreaterThanOrEqual(64);
        expect(freePortRange("41", "100")).toEqual(freePortRange("1", "100"));
    });

    test("wraps a worker id above the count onto an existing slice", () => {
        expect(freePortRange("5", "4")).toEqual(freePortRange("1", "4"));
    });
});

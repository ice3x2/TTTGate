import fs from "fs";
import Path from "path";
import Environment from "../../../../src/Environment";
import type {AuditEvent} from "../../../../src/server/audit/AuditSink";
import {AuditBackpressureError, FileAuditSink} from "../../../../src/server/audit/FileAuditSink";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

jest.setTimeout(30_000);

type StubStream = {
    lines: string[];
    writeCalls: number;
    write(chunk: any, cb?: (error?: Error | null) => void): boolean;
    once(event: string, listener: (...args: any[]) => void): StubStream;
    on(event: string, listener: (...args: any[]) => void): StubStream;
    end(cb?: () => void): StubStream;
    emit(event: string): void;
};

/**
 * 배압 경계를 재현하는 쓰기 스트림 스텁.
 * write 가 false 를 돌려주고 drain 을 내지 않으면 큐가 비지 않아, reserve()/record() 의 거부 경계가 드러난다.
 */
const createStubStream = (options: {
    writeResult?: (call: number) => boolean;
    invokeCallback?: (call: number, done: () => void) => void;
    beforeWriteReturn?: (call: number) => void;
} = {}): StubStream => {
    const listeners = new Map<string, Array<(...args: any[]) => void>>();
    const stream: StubStream = {
        lines: [],
        writeCalls: 0,
        write(chunk: any, cb?: (error?: Error | null) => void): boolean {
            const call = stream.writeCalls++;
            stream.lines.push(String(chunk));
            options.beforeWriteReturn?.(call);
            if(cb) {
                const invoke = options.invokeCallback ?? ((_call: number, done: () => void) => done());
                invoke(call, () => cb(null));
            }
            return options.writeResult ? options.writeResult(call) : true;
        },
        once(event: string, listener: (...args: any[]) => void): StubStream {
            const list = listeners.get(event) ?? [];
            list.push(listener);
            listeners.set(event, list);
            return stream;
        },
        on(event: string, listener: (...args: any[]) => void): StubStream {
            return stream.once(event, listener);
        },
        end(cb?: () => void): StubStream {
            cb?.();
            return stream;
        },
        emit(event: string): void {
            const list = listeners.get(event) ?? [];
            listeners.set(event, []);
            list.forEach((listener) => listener());
        }
    };
    return stream;
};

const eventAt = (at: number, patch: Partial<AuditEvent> = {}): AuditEvent => ({
    at,
    actor: {userId: "u_1", username: "admin", role: "superuser"},
    sessionIdHash: "0123456789abcdef",
    ip: "127.0.0.1",
    type: "user_created",
    target: {kind: "user", id: "u_1"},
    outcome: "success",
    summary: "user_created u_1",
    ...patch
});

const linesOf = (file: string): string[] =>
    fs.readFileSync(file, "utf8").split("\n").filter((line) => line.length > 0);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("FileAuditSink", () => {
    let testRoot: TestRoot;
    let dir: string;

    beforeEach(async () => {
        testRoot = await createTestRoot("file-audit-sink");
        applyTestRoot(testRoot.rootDir);
        dir = Path.join(Environment.path.logDir, "audit");
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    it("한 건을 기록하고 flush 하면 UTC 날짜 파일에 한 줄이 남는다", async () => {
        const sink = new FileAuditSink({dir, queueSize: 10, retentionDays: 0});
        const event = eventAt(Date.UTC(2026, 8, 11, 5, 30));
        await sink.record(event);
        await sink.flush();

        const file = Path.join(dir, "audit-2026-09-11.jsonl");
        expect(fs.existsSync(file)).toBe(true);
        const lines = linesOf(file);
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0])).toEqual(event);

        await sink.close();
    });

    it("UTC 날짜가 바뀌는 두 건이 각각 다른 파일에 한 줄씩 들어간다", async () => {
        const sink = new FileAuditSink({dir, queueSize: 10, retentionDays: 0});
        await sink.record(eventAt(Date.parse("2026-09-11T23:59:59.000Z")));
        await sink.record(eventAt(Date.parse("2026-09-12T00:00:00.000Z")));
        await sink.flush();

        expect(linesOf(Path.join(dir, "audit-2026-09-11.jsonl"))).toHaveLength(1);
        expect(linesOf(Path.join(dir, "audit-2026-09-12.jsonl"))).toHaveLength(1);

        await sink.close();
    });

    it("fileNameFor 는 UTC 날짜로 파일명을 만든다", () => {
        expect(FileAuditSink.fileNameFor(Date.parse("2026-09-11T23:59:59.000Z"))).toBe("audit-2026-09-11.jsonl");
        expect(FileAuditSink.fileNameFor(Date.parse("2026-09-12T00:00:00.000Z"))).toBe("audit-2026-09-12.jsonl");
    });

    it("선점이 큐 상한을 정확히 나눠 가지고 네 번째 record 는 배압으로 거부된다", async () => {
        const stream = createStubStream({writeResult: () => false, invokeCallback: () => {}});
        const sink = new FileAuditSink({dir, queueSize: 3, retentionDays: 0, openStream: () => stream});

        expect(sink.reserve()).toBe(true);
        expect(sink.reserve()).toBe(true);
        expect(sink.reserve()).toBe(true);
        expect(sink.reserve()).toBe(false);
        expect(sink.reservedCount).toBe(3);

        await expect(sink.record(eventAt(1_757_548_800_000))).resolves.toBeUndefined();
        await expect(sink.record(eventAt(1_757_548_800_001))).resolves.toBeUndefined();
        await expect(sink.record(eventAt(1_757_548_800_002))).resolves.toBeUndefined();
        expect(sink.queueLength).toBe(3);
        expect(sink.reservedCount).toBe(0);

        await expect(sink.record(eventAt(1_757_548_800_003))).rejects.toBeInstanceOf(AuditBackpressureError);
    });

    it("reserve 없이 record 만 부르면 상한을 넘는 네 번째가 거부된다", async () => {
        const stream = createStubStream({writeResult: () => false, invokeCallback: () => {}});
        const sink = new FileAuditSink({dir, queueSize: 3, retentionDays: 0, openStream: () => stream});

        await sink.record(eventAt(1_757_548_800_000));
        await sink.record(eventAt(1_757_548_800_001));
        await sink.record(eventAt(1_757_548_800_002));
        await expect(sink.record(eventAt(1_757_548_800_003))).rejects.toBeInstanceOf(AuditBackpressureError);
        expect(sink.queueLength).toBe(3);
    });

    it("선점 하나를 record 가 소비하고 남은 선점은 그대로 센다", async () => {
        const stream = createStubStream({writeResult: () => false, invokeCallback: () => {}});
        const sink = new FileAuditSink({dir, queueSize: 3, retentionDays: 0, openStream: () => stream});

        expect(sink.reserve()).toBe(true);
        expect(sink.reserve()).toBe(true);
        await sink.record(eventAt(1_757_548_800_000));

        expect(sink.reservedCount).toBe(1);
        expect(sink.queueLength).toBe(1);
        expect(sink.queueLength + sink.reservedCount).toBe(2);
    });

    it("쓰기 대기 중인 항목도 큐에 남고 drain 전에는 다음 write 가 불리지 않는다", async () => {
        let queueLengthAtFirstWrite = -1;
        const stream = createStubStream({
            writeResult: (call) => call !== 0,
            invokeCallback: (_call, done) => { setImmediate(done); },
            beforeWriteReturn: (call) => { if(call === 0) queueLengthAtFirstWrite = sink.queueLength; }
        });
        const sink = new FileAuditSink({dir, queueSize: 10, retentionDays: 0, openStream: () => stream});

        await sink.record(eventAt(1_757_548_800_000, {summary: "first"}));
        await sink.record(eventAt(1_757_548_800_001, {summary: "second"}));
        await sink.record(eventAt(1_757_548_800_002, {summary: "third"}));

        const flushed = sink.flush();
        await sleep(30);
        expect(stream.writeCalls).toBe(1);
        expect(queueLengthAtFirstWrite).toBe(3);
        expect(sink.queueLength).toBe(3);

        setTimeout(() => stream.emit("drain"), 100);
        await flushed;

        expect(sink.queueLength).toBe(0);
        expect(stream.lines).toHaveLength(3);
        expect(stream.lines.map((line) => JSON.parse(line).summary)).toEqual(["first", "second", "third"]);
    });

    it("flush 는 마지막 write 의 콜백이 불린 뒤에 resolve 된다", async () => {
        let callbackCalled = false;
        const stream = createStubStream({
            invokeCallback: (_call, done) => { setTimeout(() => { callbackCalled = true; done(); }, 100); }
        });
        const sink = new FileAuditSink({dir, queueSize: 10, retentionDays: 0, openStream: () => stream});

        await sink.record(eventAt(1_757_548_800_000));
        await sink.flush();
        expect(callbackCalled).toBe(true);
    });

    // #142 — 쓰기 오류에서 항목을 버리지 않는다(드롭 금지).
    it("write 콜백이 오류를 돌려주면 그 항목을 큐에 남기고 새 스트림으로 다시 쓴다", async () => {
        const failing = createStubStream({invokeCallback: (_call, done) => done()});
        failing.write = function(chunk: any, cb?: (error?: Error | null) => void): boolean {
            failing.writeCalls++;
            cb?.(Object.assign(new Error("ENOSPC: no space left on device"), {code: "ENOSPC"}));
            return true;
        };
        const healthy = createStubStream();
        const streams = [failing, healthy];
        const sink = new FileAuditSink({dir, queueSize: 10, retentionDays: 0, openStream: () => streams.shift() ?? healthy});

        await sink.record(eventAt(1_757_548_800_000, {summary: "first"}));
        await sink.record(eventAt(1_757_548_800_001, {summary: "second"}));
        await sink.flush();

        expect(failing.writeCalls).toBe(1);
        expect(healthy.lines.map((line) => JSON.parse(line).summary)).toEqual(["first", "second"]);
        expect(sink.queueLength).toBe(0);
    });

    it("감사 디렉터리를 지운 뒤 기록하면 디렉터리를 다시 만들고 항목을 남긴다", async () => {
        const sink = new FileAuditSink({dir, queueSize: 10, retentionDays: 0});
        const at = 1_757_548_800_000;
        await sink.record(eventAt(at, {summary: "before"}));
        await sink.flush();
        // 열린 스트림이 같은 이름의 파일을 잡고 있지 않도록 다음 날짜로 쓴다(파일 교체 경로를 탄다).
        fs.rmSync(dir, {recursive: true, force: true});
        await sink.record(eventAt(at + 86_400_000, {summary: "after"}));
        await sink.flush();
        await sink.close();
        const file = Path.join(dir, FileAuditSink.fileNameFor(at + 86_400_000));
        expect(linesOf(file).map((line) => JSON.parse(line).summary)).toEqual(["after"]);
    });

    it("쓰기가 계속 실패하면 큐가 차서 reserve() 가 false 이고, close 는 정해진 시간 안에 끝난다", async () => {
        const failing = createStubStream();
        failing.write = function(_chunk: any, cb?: (error?: Error | null) => void): boolean {
            failing.writeCalls++;
            cb?.(new Error("EACCES"));
            return true;
        };
        const sink = new FileAuditSink({dir, queueSize: 3, retentionDays: 0, openStream: () => failing, closeTimeoutMs: 300});
        for(let i = 0; i < 3; i += 1) {
            expect(sink.reserve()).toBe(true);
            await sink.record(eventAt(1_757_548_800_000 + i));
        }
        await sleep(50);
        expect(sink.queueLength).toBe(3);
        expect(sink.reserve()).toBe(false);
        const started = Date.now();
        await sink.close();
        expect(Date.now() - started).toBeLessThan(5_000);
    });

    it("close 가 시간 초과로 끝난 뒤 늦게 온 쓰기 실패는 재시도하지 않고 스트림을 다시 열지 않는다", async () => {
        let held: ((error?: Error | null) => void) | undefined;
        const stream = createStubStream();
        stream.write = function(_chunk: any, cb?: (error?: Error | null) => void): boolean {
            stream.writeCalls++;
            held = cb;
            return true;
        };
        let opened = 0;
        const sink = new FileAuditSink({dir, queueSize: 3, retentionDays: 0, openStream: () => { opened++; return stream; }, closeTimeoutMs: 100});
        await sink.record(eventAt(1_757_548_800_000));
        await sleep(20);
        expect(held).toBeDefined();
        await sink.close();
        held!(new Error("EIO"));
        await sleep(600);
        expect(opened).toBe(1);
        expect(stream.writeCalls).toBe(1);
    });

    it("detail 의 민감 키만 마스킹하고 입력 객체는 건드리지 않는다", async () => {
        const sink = new FileAuditSink({dir, queueSize: 10, retentionDays: 0});
        const detail = {password: "p", totp: "123456", code: "111111", recoveryCode: "abcd-efgh", note: "x"};
        const event = eventAt(Date.UTC(2026, 8, 11, 1), {detail});

        await sink.record(event);
        await sink.flush();

        const written = JSON.parse(linesOf(Path.join(dir, "audit-2026-09-11.jsonl"))[0]);
        expect(written.detail).toEqual({
            password: "[REDACTED]", totp: "[REDACTED]", code: "[REDACTED]", recoveryCode: "[REDACTED]", note: "x"
        });
        expect(detail.password).toBe("p");
        expect(detail.totp).toBe("123456");

        await sink.close();
    });

    describe("pruneRetention", () => {
        const PRUNE_FIXTURE = [
            "audit-2026-09-08.jsonl", "audit-2026-09-09.jsonl",
            "audit-2026-09-10.jsonl", "audit-2026-09-11.jsonl", "other.txt"
        ];

        const seed = (names: string[]): void => {
            fs.mkdirSync(dir, {recursive: true});
            names.forEach((name) => fs.writeFileSync(Path.join(dir, name), ""));
        };

        it("보존 기간이 지난 파일만 지우고 삭제 사실을 스스로 기록한다", async () => {
            seed(PRUNE_FIXTURE);
            const sink = new FileAuditSink({dir, queueSize: 10, retentionDays: 2});

            const removed = sink.pruneRetention(Date.UTC(2026, 8, 11, 12));
            expect(removed).toEqual(["audit-2026-09-08.jsonl"]);
            expect(fs.existsSync(Path.join(dir, "audit-2026-09-08.jsonl"))).toBe(false);
            expect(fs.existsSync(Path.join(dir, "audit-2026-09-09.jsonl"))).toBe(true);
            expect(fs.existsSync(Path.join(dir, "audit-2026-09-10.jsonl"))).toBe(true);
            expect(fs.existsSync(Path.join(dir, "other.txt"))).toBe(true);

            await sink.flush();
            const lines = linesOf(Path.join(dir, "audit-2026-09-11.jsonl"));
            const last = JSON.parse(lines[lines.length - 1]);
            expect(last.type).toBe("audit_retention_pruned");
            expect(last.detail.files).toEqual(["audit-2026-09-08.jsonl"]);
            expect(last.detail.retentionDays).toBe(2);

            await sink.close();
        });

        it("retentionDays 0 은 무제한이라 아무것도 지우지 않는다", async () => {
            seed(PRUNE_FIXTURE);
            const sink = new FileAuditSink({dir, queueSize: 10, retentionDays: 0});

            expect(sink.pruneRetention(Date.UTC(2026, 8, 11, 12))).toEqual([]);
            PRUNE_FIXTURE.forEach((name) => expect(fs.existsSync(Path.join(dir, name))).toBe(true));

            await sink.close();
        });

        it("경계는 파일 날짜의 다음날 00:00 UTC 기준이다", async () => {
            seed(["audit-2026-09-09.jsonl", "audit-2026-09-10.jsonl", "audit-2026-09-11.jsonl"]);
            const sink = new FileAuditSink({dir, queueSize: 10, retentionDays: 1});

            expect(sink.pruneRetention(Date.UTC(2026, 8, 11, 0, 0, 30))).toEqual(["audit-2026-09-09.jsonl"]);
            expect(fs.existsSync(Path.join(dir, "audit-2026-09-10.jsonl"))).toBe(true);

            await sink.close();
        });

        it("디렉터리가 없으면 빈 배열을 돌려준다", () => {
            const sink = new FileAuditSink({dir, queueSize: 10, retentionDays: 30});
            expect(fs.existsSync(dir)).toBe(false);
            expect(sink.pruneRetention(Date.UTC(2026, 8, 11, 12))).toEqual([]);
        });
    });

    const posixIt = process.platform === "win32" ? it.skip : it;
    posixIt("POSIX 에서 디렉터리 0o700, 파일 0o600 으로 만든다", async () => {
        const sink = new FileAuditSink({dir, queueSize: 10, retentionDays: 0});
        await sink.record(eventAt(Date.UTC(2026, 8, 11, 2)));
        await sink.flush();

        expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
        expect(fs.statSync(Path.join(dir, "audit-2026-09-11.jsonl")).mode & 0o777).toBe(0o600);

        await sink.close();
    });

    it("close 뒤에는 선점도 기록도 받지 않는다", async () => {
        const sink = new FileAuditSink({dir, queueSize: 10, retentionDays: 0});
        await sink.record(eventAt(Date.UTC(2026, 8, 11, 3)));
        await sink.close();

        expect(sink.reserve()).toBe(false);
        await expect(sink.record(eventAt(Date.UTC(2026, 8, 11, 4)))).rejects.toBeInstanceOf(AuditBackpressureError);
    });

    // audited() 는 reserve() 시점의 싱크 참조를 들고 있다가 핸들러가 끝난 뒤 그 참조에 기록한다.
    // 감사 옵션을 바꾸는 저장은 핸들러 안에서 싱크를 갈아 끼우므로, 잡아 둔 칸이 있는 채로
    // 닫히는 일이 실제로 일어난다. 그 칸의 기록을 버리면 그 저장 사실이 어디에도 남지 않는다.
    it("선점한 칸이 있으면 close 뒤에도 그 기록을 받아 파일에 쓴다", async () => {
        const sink = new FileAuditSink({dir, queueSize: 10, retentionDays: 0});
        expect(sink.reserve()).toBe(true);

        await sink.close();

        // 잡아 둔 칸의 기록은 받아들여 디스크까지 쓴다. 선점은 소유되지 않으므로 첫 record() 가 그 칸을 쓴다.
        await sink.record(eventAt(Date.UTC(2026, 8, 11, 5)));
        await sink.flush();
        // 칸을 다 쓴 뒤의 새 기록은 닫힌 싱크에서 거부된다.
        await expect(sink.record(eventAt(Date.UTC(2026, 8, 11, 6)))).rejects.toBeInstanceOf(AuditBackpressureError);

        const file = Path.join(dir, "audit-2026-09-11.jsonl");
        const lines = fs.readFileSync(file, "utf-8").trim().split("\n");
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0]).at).toBe(Date.UTC(2026, 8, 11, 5));
        expect(sink.reservedCount).toBe(0);
    });

    it("옵션 교체 판정에 쓰는 게터가 생성 옵션을 그대로 돌려준다", () => {
        const sink = new FileAuditSink({dir, queueSize: 1000, retentionDays: 90});
        expect(sink.retentionDays).toBe(90);
        expect(sink.queueSize).toBe(1000);
    });
});

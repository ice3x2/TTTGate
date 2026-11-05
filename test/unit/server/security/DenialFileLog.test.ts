import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {DENIAL_LOG_MAX_KEYS, DenialFileLog} from "../../../../src/server/security/DenialFileLog";

// #327 REQ-7~15: 거절 로그 파일. (IP, 범위, 사유)별 1분 묶음을 denial-YYYY.MM.DD.log 에 append 한다.
const dateSuffix = (daysAgo: number): string => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
};
const today = () => `denial-${dateSuffix(0)}.log`;
const countries: Record<string, string> = {"203.0.113.7": "CN"};

let dir: string;
let log: DenialFileLog | undefined;
const create = (maxKeys?: number) => {
    log = new DenialFileLog({dir, countryOf: (ip) => countries[ip], maxKeys});
    return log;
};
const lines = (): string[] => {
    const file = path.join(dir, today());
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trimEnd().split("\n").filter(Boolean) : [];
};

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-denial-log-"));
});
afterEach(async () => {
    await log?.closeForTest();
    log = undefined;
    fs.rmSync(dir, {recursive: true, force: true});
});

test("AC-3 five denials of one key in a window become one line after the window closes", async () => {
    const denialLog = create();
    denialLog.configure(20);
    for(let i = 0; i < 5; i++) denialLog.record(8080, "203.0.113.7", "geo-deny", 1000 + i * 10_000);
    expect(denialLog.flushDue(60_999)).toBe(0);
    expect(denialLog.flushDue(61_000)).toBe(1);
    await denialLog.closeForTest();

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(/^\S+Z \[INFO\] Denial:: first=1970-01-01T00:00:01\.000Z last=1970-01-01T00:00:41\.000Z ip=203\.0\.113\.7 country=CN port=8080 reason=geo-deny count=5$/);
});

test("the admin scope is port=admin and an unknown country is country=-", async () => {
    const denialLog = create();
    denialLog.configure(20);
    denialLog.record("admin", "198.51.100.1", "geo-deny", 0);
    denialLog.flushDue(60_000);
    await denialLog.closeForTest();
    expect(lines()[0]).toContain(" ip=198.51.100.1 country=- port=admin reason=geo-deny count=1");
});

test("AC-4 keys beyond the limit are merged into one ip=* line per (scope, reason)", async () => {
    expect(DENIAL_LOG_MAX_KEYS).toBe(10_000);
    const denialLog = create(3);
    denialLog.configure(20);
    for(const ip of ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"]) denialLog.record(1, ip, "ip-blocklist", 0);
    denialLog.flushDue(60_000);
    await denialLog.closeForTest();

    const written = lines();
    expect(written).toHaveLength(4);
    expect(written.filter((line) => line.includes(" ip=* "))).toHaveLength(1);
    expect(written.find((line) => line.includes(" ip=* "))).toContain(" country=- port=1 reason=ip-blocklist count=2");
});

test("AC-6 retention zero or less writes no file and leaves existing files", async () => {
    const old = `denial-${dateSuffix(400)}.log`;
    fs.writeFileSync(path.join(dir, old), "kept\n");
    for(const days of [0, -3]) {
        const denialLog = create();
        denialLog.configure(days);
        denialLog.record(1, "10.0.0.1", "geo-deny", 0);
        expect(denialLog.flushDue(60_000)).toBe(0);
        await denialLog.closeForTest();
    }
    expect(fs.readdirSync(dir)).toEqual([old]);
});

test("REQ-15 turning the log off drops the groups not yet written", async () => {
    const denialLog = create();
    denialLog.configure(20);
    denialLog.record(1, "10.0.0.1", "geo-deny", 0);
    denialLog.configure(0);
    denialLog.configure(20);
    expect(denialLog.flushDue(60_000)).toBe(0);
    await denialLog.closeForTest();
    expect(lines()).toEqual([]);
});

test("REQ-14 saving a retention sweeps at once, and the hourly tick sweeps on days without denials", async () => {
    const expiredAtOnce = `denial-${dateSuffix(20)}.log`;
    fs.writeFileSync(path.join(dir, expiredAtOnce), "old\n");
    const denialLog = create();
    denialLog.configure(20, 0);
    expect(fs.existsSync(path.join(dir, expiredAtOnce))).toBe(false);

    const expiredLater = `denial-${dateSuffix(25)}.log`;
    fs.writeFileSync(path.join(dir, expiredLater), "old\n");
    denialLog.tick(59 * 60_000);
    expect(fs.existsSync(path.join(dir, expiredLater))).toBe(true);
    denialLog.tick(60 * 60_000);
    expect(fs.existsSync(path.join(dir, expiredLater))).toBe(false);
});

test("the tick also writes the groups whose window has closed", async () => {
    const denialLog = create();
    denialLog.configure(20, 0);
    denialLog.record(1, "10.0.0.1", "rate-limit-ban", 0);
    denialLog.tick(60_000);
    await denialLog.closeForTest();
    expect(lines()).toHaveLength(1);
});

test("AC-11 an unwritable directory does not throw", async () => {
    const blocked = path.join(dir, "not-a-dir");
    fs.writeFileSync(blocked, "");
    log = new DenialFileLog({dir: blocked, countryOf: () => undefined});
    expect(() => {
        log!.configure(20);
        log!.record(1, "10.0.0.1", "geo-deny", 0);
        log!.flushDue(60_000);
        log!.tick(60 * 60_000);
    }).not.toThrow();
});

test("AC-9 denial lines do not go to the console", async () => {
    const consoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
        const denialLog = create();
        denialLog.configure(20);
        denialLog.record(1, "10.0.0.1", "geo-deny", 0);
        denialLog.flushDue(60_000);
        await denialLog.closeForTest();
        expect(lines()).toHaveLength(1);
        expect(consoleLog).not.toHaveBeenCalled();
    } finally {
        consoleLog.mockRestore();
    }
});

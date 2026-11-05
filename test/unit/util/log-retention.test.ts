import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {once} from "events";
import {LogWriter} from "../../../src/util/logger/LogWriter";

const dateSuffix = (daysAgo: number): string => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
};

const withLogs = async (name: string, history: number | undefined, files: string[], check: (directory: string) => void) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-retention-"));
    let writer: LogWriter | undefined;
    try {
        for(const file of files) fs.writeFileSync(path.join(directory, file), "retained content\n");
        writer = LogWriter.create({name, path: directory, history, file: true, console: false});
        // #208: 파일은 첫 기록 때 연다. 오래된 로그 정리도 그때 한다.
        writer.pushMessage({name, module: "", message: "opened", day: 0, level: "info" as never});
        check(directory);
    } finally {
        // The production end API is synchronous; observe the real owned stream
        // closing before removing its temporary directory on Windows.
        const stream = (writer as unknown as {_logFileStream?: fs.WriteStream} | undefined)?._logFileStream;
        const closed = stream ? once(stream, "close") : Promise.resolve();
        writer?.end();
        await closed;
        fs.rmSync(directory, {recursive: true, force: true});
    }
};

test("history two removes expired logs and preserves recent and unrelated files", async () => {
    const expired = `server-${dateSuffix(5)}.log`;
    const preserved = [`server-${dateSuffix(1)}.log`, `server-${dateSuffix(0)}.log`,
        `client-${dateSuffix(5)}.log`, `${expired}.bak`, "server-2000x01x01.log", "notes.txt"];
    await withLogs("server", 2, [expired, ...preserved], (directory) => {
        expect(fs.existsSync(path.join(directory, expired))).toBe(false);
        for(const file of preserved) expect(fs.readFileSync(path.join(directory, file), "utf8")).toBe("retained content\n");
    });
});

test("logger regex metacharacters are literal and cannot select another logger", async () => {
    const name = "server[prod]+.(v1)";
    const expired = `${name}-${dateSuffix(5)}.log`;
    const preserved = [`${name}-${dateSuffix(1)}.log`, `serverpXv1-${dateSuffix(5)}.log`,
        `prefix-${expired}`, `${name}-2000x01x01.log`];
    await withLogs(name, 2, [expired, ...preserved], (directory) => {
        expect(fs.existsSync(path.join(directory, expired))).toBe(false);
        for(const file of preserved) expect(fs.readFileSync(path.join(directory, file), "utf8")).toBe("retained content\n");
    });
});

test("default history retains twenty-day logs and removes forty-day logs", async () => {
    const expired = `server-${dateSuffix(40)}.log`;
    const recent = `server-${dateSuffix(20)}.log`;
    await withLogs("server", undefined, [expired, recent], (directory) => {
        expect(fs.existsSync(path.join(directory, expired))).toBe(false);
        expect(fs.existsSync(path.join(directory, recent))).toBe(true);
    });
});

test("history zero preserves unlimited retention", async () => {
    const old = `server-${dateSuffix(400)}.log`;
    await withLogs("server", 0, [old], (directory) => {
        expect(fs.readFileSync(path.join(directory, old), "utf8")).toBe("retained content\n");
    });
});

// #327 REQ-13·14: 거절 로그는 history 와 다른 규칙을 쓴다. 경과 일수가 retentionDays 이상이면 지운다(파일 날짜가 1일째).
const sweepWith = async (retentionDays: number, history: number | undefined, files: string[], check: (directory: string) => void) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-retention-days-"));
    try {
        for(const file of files) fs.writeFileSync(path.join(directory, file), "retained content\n");
        const writer = LogWriter.create({name: "denial", path: directory, history, file: true, console: false});
        writer.retentionDays = retentionDays;
        // 아무것도 쓰지 않아도 지운다(거절이 없는 날, REQ-14).
        writer.sweepExpired();
        check(directory);
        writer.end();
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
};

test("retentionDays twenty removes the file on its twenty-first day and keeps the one before", async () => {
    const expired = `denial-${dateSuffix(20)}.log`;
    const kept = `denial-${dateSuffix(19)}.log`;
    await sweepWith(20, 0, [expired, kept], (directory) => {
        expect(fs.existsSync(path.join(directory, expired))).toBe(false);
        expect(fs.existsSync(path.join(directory, kept))).toBe(true);
    });
});

test("retentionDays one keeps only today's file, even though history zero would keep everything", async () => {
    const yesterday = `denial-${dateSuffix(1)}.log`;
    const today = `denial-${dateSuffix(0)}.log`;
    await sweepWith(1, 0, [yesterday, today], (directory) => {
        expect(fs.existsSync(path.join(directory, yesterday))).toBe(false);
        expect(fs.existsSync(path.join(directory, today))).toBe(true);
    });
});

test("retentionDays replaces the default history rule and leaves other loggers' files alone", async () => {
    // history 가 없으면 30 이 기본값이다. retentionDays 를 정하면 그 규칙이 돌지 않는다.
    const old = `denial-${dateSuffix(35)}.log`;
    const other = `server-${dateSuffix(35)}.log`;
    await sweepWith(40, undefined, [old, other], (directory) => {
        expect(fs.existsSync(path.join(directory, old))).toBe(true);
        expect(fs.existsSync(path.join(directory, other))).toBe(true);
    });
});

test("sweepExpired does not create a missing log directory", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-retention-missing-"));
    const directory = path.join(parent, "logs");
    try {
        const writer = LogWriter.create({name: "denial", path: directory, history: 0, file: true, console: false});
        writer.retentionDays = 20;
        writer.sweepExpired();
        expect(fs.existsSync(directory)).toBe(false);
        writer.end();
    } finally {
        fs.rmSync(parent, {recursive: true, force: true});
    }
});

// #327 리뷰 C-1: 시간 주기 정리가 날짜 상태를 바꾸면, 자정 뒤의 줄이 어제 파일(이미 지운 파일일 수도 있다)에 들어간다.
test("an hourly sweep after midnight does not keep writing into yesterday's file", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-retention-midnight-"));
    jest.useFakeTimers({doNotFake: ["nextTick", "setImmediate", "queueMicrotask"]});
    try {
        jest.setSystemTime(new Date(2026, 10, 5, 23, 50));
        const writer = LogWriter.create({name: "denial", path: directory, history: 0, file: true, console: false});
        writer.retentionDays = 1;
        writer.pushMessage({name: "denial", module: "", message: "before midnight", day: 0, level: "info" as never});
        await new Promise((resolve) => setImmediate(resolve));

        jest.setSystemTime(new Date(2026, 10, 6, 0, 40));
        writer.sweepExpired();
        writer.pushMessage({name: "denial", module: "", message: "after midnight", day: 0, level: "info" as never});
        await writer.endAsync();

        const today = path.join(directory, "denial-2026.11.06.log");
        expect(fs.existsSync(today)).toBe(true);
        expect(fs.readFileSync(today, "utf8")).toContain("after midnight");
    } finally {
        jest.useRealTimers();
        fs.rmSync(directory, {recursive: true, force: true});
    }
});

// 거절이 없는 날에는 어제 파일이 열린 채 남는다. 시간 주기 정리는 열려 있는 파일을 지우지 않는다(Windows 에서는 지울 수 없다).
// 다음 줄이 오늘 파일을 연 뒤에 지운다.
test("the hourly sweep leaves the file that is still open, and the next day's first line removes it", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-retention-open-"));
    jest.useFakeTimers({doNotFake: ["nextTick", "setImmediate", "queueMicrotask"]});
    try {
        jest.setSystemTime(new Date(2026, 10, 5, 23, 50));
        const writer = LogWriter.create({name: "denial", path: directory, history: 0, file: true, console: false});
        writer.retentionDays = 1;
        writer.pushMessage({name: "denial", module: "", message: "before midnight", day: 0, level: "info" as never});
        await new Promise((resolve) => setImmediate(resolve));
        const yesterday = path.join(directory, "denial-2026.11.05.log");

        jest.setSystemTime(new Date(2026, 10, 6, 0, 40));
        writer.sweepExpired();
        expect(fs.existsSync(yesterday)).toBe(true);

        // 다음 줄이 오늘 파일을 열면서(nextLogFile) 어제 파일을 지운다. 따로 sweepExpired 를 부르지 않는다.
        writer.pushMessage({name: "denial", module: "", message: "after midnight", day: 0, level: "info" as never});
        await new Promise((resolve) => setImmediate(resolve));
        expect(fs.existsSync(yesterday)).toBe(false);
        await writer.endAsync();
    } finally {
        jest.useRealTimers();
        fs.rmSync(directory, {recursive: true, force: true});
    }
});

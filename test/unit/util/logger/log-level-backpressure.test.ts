import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {EventEmitter} from "events";
import {LogWriter} from "../../../../src/util/logger/LogWriter";

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-log-level-"));
const message = (level: "debug" | "info" | "warn" | "error", text: string) => ({name: "server", module: "T", message: text, day: 0, level});

// #249 — 설정한 레벨보다 낮은 로그는 남기지 않는다.
describe("log level (#249 REQ-1)", () => {
    test.each([
        ["info", ["info", "warn", "error"]],
        ["warn", ["warn", "error"]],
        ["debug", ["debug", "info", "warn", "error"]],
    ] as const)("a writer at level %s writes only %j to the file and the console", async (level, expected) => {
        const directory = tempDir();
        const console = jest.spyOn(global.console, "log").mockImplementation(() => undefined);
        try {
            const writer = LogWriter.create({name: "server", path: directory, file: true, console: true, level});
            for(const each of ["debug", "info", "warn", "error"] as const) writer.pushMessage(message(each, `${each}-line`));
            await writer.endAsync();
            const text = fs.readdirSync(directory).map((file) => fs.readFileSync(path.join(directory, file), "utf-8")).join("");
            for(const each of ["debug", "info", "warn", "error"]) {
                expect({each, inFile: text.includes(`${each}-line`)}).toEqual({each, inFile: (expected as readonly string[]).includes(each)});
            }
            const printed = console.mock.calls.map((call) => String(call[0])).join("\n");
            expect(printed.includes("debug-line")).toBe((expected as readonly string[]).includes("debug"));
        } finally {
            console.mockRestore();
            fs.rmSync(directory, {recursive: true, force: true});
        }
    });
});

/** 쓰기가 끝나지 않는(디스크가 느린) 파일 스트림. drain() 으로 비운다. */
class SlowStream extends EventEmitter {
    public writableLength = 0;
    /** Node 처럼 쓰기가 쌓여 있을 때만 drain 을 기다린다. */
    public get writableNeedDrain(): boolean { return this.writableLength > 0; }
    public destroyed = false;
    public closed = false;
    public writableFinished = false;
    public lines: string[] = [];
    public write(line: string): boolean { this.lines.push(line); this.writableLength += Buffer.byteLength(line); return false; }
    public end(callback?: () => void): void { this.closed = true; callback?.(); }
    public drain(): void { this.writableLength = 0; this.emit("drain"); }
}

// #249 — 파일 쓰기 대기량이 상한을 넘으면 새 줄을 파일에 쓰지 않고 센다. 다시 쓸 수 있게 되면 버린 수를 한 줄로 남긴다.
describe("log file backpressure (#249 REQ-2)", () => {
    test("pending file output stays under the limit while the disk is slow, and the dropped count is logged once after drain", async () => {
        const directory = tempDir();
        const stream = new SlowStream();
        const create = jest.spyOn(require("fs") as typeof fs, "createWriteStream").mockImplementation((() => stream) as any);
        const console = jest.spyOn(global.console, "log").mockImplementation(() => undefined);
        try {
            const writer = LogWriter.create({name: "server", path: directory, file: true, console: true, level: "info"});
            const line = "x".repeat(200);
            for(let n = 0; n < 100_000; n++) writer.pushMessage(message("info", `${n} ${line}`));
            // 큐가 다음 틱에 스트림으로 넘어가도록 기다린다.
            await new Promise((resolve) => setImmediate(resolve));
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(stream.writableLength).toBeLessThanOrEqual(8 * 1024 * 1024 + 1024);
            // 파일에 쓰지 못한 줄도 콘솔에는 남는다.
            expect(console.mock.calls.length).toBe(100_000);
            const written = stream.lines.length;
            expect(written).toBeLessThan(100_000);

            stream.drain();
            await new Promise((resolve) => setTimeout(resolve, 50));
            const notices = stream.lines.filter((each) => /dropped \d+ log lines from the log file/i.test(each));
            expect(notices.length).toBe(1);
            expect(notices[0]).toContain(`${100_000 - written}`);
            await writer.endAsync();
        } finally {
            create.mockRestore();
            console.mockRestore();
            fs.rmSync(directory, {recursive: true, force: true});
        }
    });

    /** 파일 스트림을 흉내 낸 SlowStream 을 만들 때마다 돌려준다(파일 교체도 본다). */
    const mockStreams = () => {
        const streams: SlowStream[] = [];
        const create = jest.spyOn(require("fs") as typeof fs, "createWriteStream").mockImplementation((() => { const stream = new SlowStream(); streams.push(stream); return stream; }) as any);
        return {streams, create};
    };
    const fill = (writer: LogWriter, count: number, extra?: object) => {
        for(let n = 0; n < count; n++) writer.pushMessage({...message("info", `${n} ${"x".repeat(200)}`), ...extra});
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
    const noticesIn = (stream: SlowStream) => stream.lines.filter((each) => /dropped \d+ log lines from the log file/i.test(each));

    test("after a drain new lines reach the file again, and a second slow period gets its own notice", async () => {
        const directory = tempDir();
        const {streams, create} = mockStreams();
        const console = jest.spyOn(global.console, "log").mockImplementation(() => undefined);
        try {
            const writer = LogWriter.create({name: "server", path: directory, file: true, console: true, level: "info"});
            fill(writer, 60_000);
            await settle();
            streams[0].drain();
            await settle();
            writer.pushMessage(message("info", "after-drain"));
            await settle();
            expect(streams[0].lines.some((each) => each.includes("after-drain"))).toBe(true);
            fill(writer, 60_000);
            await settle();
            streams[0].drain();
            await settle();
            expect(noticesIn(streams[0]).length).toBe(2);
            await writer.endAsync();
        } finally { create.mockRestore(); console.mockRestore(); fs.rmSync(directory, {recursive: true, force: true}); }
    });

    // 날짜가 바뀌어 파일을 바꾸면 옛 스트림에는 drain 이 오지 않는다. 쌓인 수를 새 파일에 남긴다.
    test("lines dropped before a daily file change are reported in the new file", async () => {
        const directory = tempDir();
        const {streams, create} = mockStreams();
        const console = jest.spyOn(global.console, "log").mockImplementation(() => undefined);
        try {
            const writer = LogWriter.create({name: "server", path: directory, file: true, console: true, level: "info"});
            fill(writer, 60_000);
            await settle();
            // 다음 줄에서 날짜가 바뀐 것으로 보게 한다.
            (writer as unknown as {_todayDate: number})._todayDate = -1;
            streams[0].drain = () => undefined;
            streams[0].writableLength = 0;
            writer.pushMessage(message("info", "next-day"));
            await settle();
            expect(streams.length).toBe(2);
            expect(noticesIn(streams[1]).length).toBe(1);
            // 새 파일에서 다시 느려져도 알림이 다시 나온다(옛 스트림에 걸어 둔 기다림이 남아 있으면 나오지 않는다).
            fill(writer, 60_000);
            await settle();
            streams[1].drain();
            await settle();
            expect(noticesIn(streams[1]).length).toBe(2);
            await writer.endAsync();
        } finally { create.mockRestore(); console.mockRestore(); fs.rmSync(directory, {recursive: true, force: true}); }
    });

    // 끝낼 때 쌓인 수는 파일을 닫기 전에 남긴다.
    test("lines dropped just before the writer ends are reported before the file closes", async () => {
        const directory = tempDir();
        const {streams, create} = mockStreams();
        const console = jest.spyOn(global.console, "log").mockImplementation(() => undefined);
        try {
            const writer = LogWriter.create({name: "server", path: directory, file: true, console: true, level: "info"});
            fill(writer, 60_000);
            await settle();
            await writer.endAsync();
            expect(noticesIn(streams[0]).length).toBe(1);
        } finally { create.mockRestore(); console.mockRestore(); fs.rmSync(directory, {recursive: true, force: true}); }
    });

    // 오류의 stack 도 줄 크기에 넣는다(짧은 메시지에 큰 stack 이 붙은 warn·error 가 몰려도 상한을 지킨다).
    test("lines with large error stacks are counted with their stacks", async () => {
        const directory = tempDir();
        const {streams, create} = mockStreams();
        const console = jest.spyOn(global.console, "log").mockImplementation(() => undefined);
        try {
            const writer = LogWriter.create({name: "server", path: directory, file: true, console: true, level: "info"});
            const error = Object.assign(new Error("boom"), {stack: "Error: boom\n" + "    at frame\n".repeat(200)});
            for(let n = 0; n < 20_000; n++) writer.pushMessage({...message("error", "x"), error});
            await settle();
            expect(streams[0].writableLength).toBeLessThanOrEqual(8 * 1024 * 1024 + 4096);
            await writer.endAsync();
        } finally { create.mockRestore(); console.mockRestore(); fs.rmSync(directory, {recursive: true, force: true}); }
    });

    // 알림은 writer 레벨과 상관없이 남는다(레벨이 error 여도).
    test("the dropped-lines notice is kept even when the writer level is error", async () => {
        const directory = tempDir();
        const {streams, create} = mockStreams();
        const console = jest.spyOn(global.console, "log").mockImplementation(() => undefined);
        try {
            const writer = LogWriter.create({name: "server", path: directory, file: true, console: true, level: "error"});
            for(let n = 0; n < 60_000; n++) writer.pushMessage(message("error", `${n} ${"x".repeat(200)}`));
            await settle();
            streams[0].drain();
            await settle();
            expect(noticesIn(streams[0]).length).toBe(1);
            await writer.endAsync();
        } finally { create.mockRestore(); console.mockRestore(); fs.rmSync(directory, {recursive: true, force: true}); }
    });

    // 상한보다 큰 줄 하나는 스트림이 비어 있어도 버려진다. 그때는 drain 이 오지 않으므로 알림을 바로 남긴다.
    test("a single line larger than the limit on an idle stream is reported without waiting for a drain", async () => {
        const directory = tempDir();
        const {streams, create} = mockStreams();
        const console = jest.spyOn(global.console, "log").mockImplementation(() => undefined);
        try {
            const writer = LogWriter.create({name: "server", path: directory, file: true, console: true, level: "info"});
            const error = Object.assign(new Error("huge"), {stack: "Error: huge\n" + "x".repeat(9 * 1024 * 1024)});
            writer.pushMessage({...message("error", "huge line"), error});
            await settle();
            expect(noticesIn(streams[0]).length).toBe(1);
            await writer.endAsync();
        } finally { create.mockRestore(); console.mockRestore(); fs.rmSync(directory, {recursive: true, force: true}); }
    });

    // 끝낼 때 남기는 알림도 콘솔에 나온다(다른 알림과 같게).
    test("the notice written while ending also goes to the console", async () => {
        const directory = tempDir();
        const {create} = mockStreams();
        const console = jest.spyOn(global.console, "log").mockImplementation(() => undefined);
        try {
            const writer = LogWriter.create({name: "server", path: directory, file: true, console: true, level: "info"});
            fill(writer, 60_000);
            await settle();
            await writer.endAsync();
            expect(console.mock.calls.some((call) => /dropped \d+ log lines from the log file/i.test(String(call[0])))).toBe(true);
        } finally { create.mockRestore(); console.mockRestore(); fs.rmSync(directory, {recursive: true, force: true}); }
    });
});

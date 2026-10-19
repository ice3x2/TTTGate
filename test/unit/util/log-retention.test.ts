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

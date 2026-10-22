import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {LogWriter} from "../../../src/util/logger/LogWriter";
import LoggerFactory from "../../../src/util/logger/LoggerFactory";
import {LoggerConfig} from "../../../src/util/logger/LoggerConfig";

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-lazy-log-"));

describe("lazy log files (#208 REQ-6a) and flush (#207 REQ-4)", () => {
    test("a writer creates no directory or file until the first message", async () => {
        const parent = tempDir();
        const directory = path.join(parent, "logs");
        try {
            const writer = LogWriter.create({name: "client", path: directory, file: true, console: false});
            expect(fs.existsSync(directory)).toBe(false);

            writer.pushMessage({name: "client", module: "", message: "first", day: 0, level: "info"});
            await writer.endAsync();
            expect(fs.readdirSync(directory).length).toBe(1);
        } finally {
            fs.rmSync(parent, {recursive: true, force: true});
        }
    });

    test("endAsync resolves after every queued line is on disk", async () => {
        const directory = tempDir();
        try {
            const writer = LogWriter.create({name: "boot", path: directory, file: true, console: false});
            for(let n = 0; n < 200; n++) writer.pushMessage({name: "boot", module: "", message: `line-${n}`, day: 0, level: "info"});
            await writer.endAsync();
            const [file] = fs.readdirSync(directory);
            const text = fs.readFileSync(path.join(directory, file), "utf-8");
            expect(text).toContain("line-0");
            expect(text).toContain("line-199");
        } finally {
            fs.rmSync(directory, {recursive: true, force: true});
        }
    });

    test("LoggerFactory.flush writes pending lines and keeps the loggers usable", async () => {
        const directory = tempDir();
        const original = LoggerFactory.cloneConfig();
        try {
            const config = LoggerConfig.create(directory);
            config.appendWriteConfig({name: "lazyflush", console: false});
            LoggerFactory.updateConfig(config);
            const logger = LoggerFactory.getLogger("lazyflush", "T");
            logger.error("before flush");
            await LoggerFactory.flush();
            const read = () => fs.readdirSync(directory).filter(f => f.startsWith("lazyflush-"))
                .map(f => fs.readFileSync(path.join(directory, f), "utf-8")).join("");
            expect(read()).toContain("before flush");

            logger.error("after flush");
            await LoggerFactory.flush();
            expect(read()).toContain("after flush");
        } finally {
            LoggerFactory.updateConfig(original);
            await LoggerFactory.flush();
            fs.rmSync(directory, {recursive: true, force: true});
        }
    });
});

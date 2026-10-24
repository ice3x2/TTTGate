import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import LoggerFactory from "../../../../src/util/logger/LoggerFactory";
import {LoggerConfig} from "../../../../src/util/logger/LoggerConfig";
import {resolveLogLevel} from "../../../../src/types/TunnelingOption";

// #267 — 서버 설정의 logLevel 을 다시 시작하지 않고 모든 로그 출력에 적용한다.
describe("runtime log level (#267)", () => {
    const original = LoggerFactory.cloneConfig();
    let directory: string;

    const read = (name: string) => fs.readdirSync(directory).filter((file) => file.startsWith(`${name}-`))
        .map((file) => fs.readFileSync(path.join(directory, file), "utf-8")).join("");

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-runtime-level-"));
        const config = LoggerConfig.create(directory);
        // 운영 writer 처럼 시작 레벨은 info 다. 콘솔 writer 도 같은 레벨을 따른다.
        config.appendWriteConfig({name: "levelfile", console: false, level: "info"});
        config.appendWriteConfig({name: "levelconsole", console: true, file: false, level: "info"});
        LoggerFactory.updateConfig(config);
    });

    afterEach(async () => {
        LoggerFactory.setLevel(undefined);
        LoggerFactory.updateConfig(original);
        await LoggerFactory.flush();
        fs.rmSync(directory, {recursive: true, force: true});
    });

    test("switching to debug writes debug lines and switching to warn drops info lines (AC-1)", async () => {
        const logger = LoggerFactory.getLogger("levelfile", "T");
        logger.debug("debug before");
        LoggerFactory.setLevel("debug");
        logger.debug("debug after switch");
        LoggerFactory.setLevel("warn");
        logger.info("info while warn");
        logger.warn("warn while warn");
        await LoggerFactory.flush();
        const text = read("levelfile");
        expect(text).not.toContain("debug before");
        expect(text).toContain("debug after switch");
        expect(text).not.toContain("info while warn");
        expect(text).toContain("warn while warn");
    });

    test("the level applies to every writer, including console writers and the default writer", () => {
        LoggerFactory.setLevel("error");
        const writers = [...(LoggerFactory as any)._logWriterMap.values()];
        expect(writers.length).toBeGreaterThanOrEqual(3);
        expect(writers.map((writer: any) => writer.level)).toEqual(writers.map(() => "error"));
    });

    test("the level survives writers being recreated by flush or a new config", async () => {
        LoggerFactory.setLevel("warn");
        await LoggerFactory.flush();
        expect([...(LoggerFactory as any)._logWriterMap.values()].every((writer: any) => writer.level === "warn")).toBe(true);
        const config = LoggerConfig.create(directory);
        config.appendWriteConfig({name: "levelfile", console: false, level: "info"});
        LoggerFactory.updateConfig(config);
        expect([...(LoggerFactory as any)._logWriterMap.values()].every((writer: any) => writer.level === "warn")).toBe(true);
    });

    test("clearing the runtime level returns each writer to its configured level", () => {
        LoggerFactory.setLevel("error");
        LoggerFactory.setLevel(undefined);
        const map: Map<string, any> = (LoggerFactory as any)._logWriterMap;
        expect(map.get("levelfile").level).toBe("info");
        expect(map.get("").level).toBe("debug");
    });
});

describe("resolveLogLevel (#267 REQ-1·REQ-3)", () => {
    test("missing value uses the default info", () => {
        expect(resolveLogLevel(undefined)).toEqual({success: true, level: "info"});
    });

    test.each(["error", "warn", "info", "debug"])("accepts %s", (level) => {
        expect(resolveLogLevel(level)).toEqual({success: true, level});
    });

    test.each(["verbose", "DEBUG", "", 1, null, ["info"]])("rejects %p", (value) => {
        expect(resolveLogLevel(value)).toMatchObject({success: false});
    });
});

import * as path from "path";
import {LoggerConfig} from "../../../../src/util/logger/LoggerConfig";

// src/util/logger/LoggerConfig.ts 의 field initializer가 그 파일 자신의 __dirname 을 사용하므로,
// 이 테스트 파일(test/unit/util/logger) 기준으로 실제 소스 디렉터리까지 네 단계 위로 올라가야 한다.
const sourceLoggerDir = path.resolve(__dirname, "../../../../src/util/logger");

describe("LoggerConfig", () => {
    it("create() only overrides _defaultPath, leaving defaultWriteConfig.path at its field-initializer value", () => {
        const config = LoggerConfig.create("/tmp/x");

        expect(config.defaultWriteConfig).toEqual({
            console: true,
            default: true,
            file: false,
            name: "",
            level: "debug",
            path: path.join(sourceLoggerDir, "log"),
            history: undefined,
            pattern: undefined
        });
    });

    it("appendWriteConfig fills in defaults and makes only the first entry the default", () => {
        const config = LoggerConfig.create("/tmp/x");

        config.appendWriteConfig({name: "a", console: false});
        expect(config.writeConfig("a")).toEqual({
            name: "a",
            console: false,
            path: "/tmp/x",
            history: 30,
            file: true,
            level: "info",
            pattern: "%d{yyyy-MM-dd hh:mm:ss.SSS} [%p] %c - %m%n",
            default: true
        });

        config.appendWriteConfig({name: "b", console: true});
        expect(config.writeConfig("b")?.default).toBe(false);
    });

    it("appendWriteConfig with default: true demotes every other entry", () => {
        const config = LoggerConfig.create("/tmp/x");
        config.appendWriteConfig({name: "a", console: false});
        config.appendWriteConfig({name: "b", console: true});

        config.appendWriteConfig({name: "c", console: true, default: true});

        expect(config.writeConfig("c")?.default).toBe(true);
        expect(config.writeConfig("a")?.default).toBe(false);
        expect(config.writeConfig("b")?.default).toBe(false);
    });

    it("writeConfigs returns clones equal in value but distinct in identity from writeConfig()", () => {
        const config = LoggerConfig.create("/tmp/x");
        config.appendWriteConfig({name: "a", console: false});
        config.appendWriteConfig({name: "b", console: true});
        config.appendWriteConfig({name: "c", console: true, default: true});

        const configs = config.writeConfigs;
        expect(configs).toHaveLength(3);
        for (const writeConfig of configs) {
            const same = config.writeConfig(writeConfig.name);
            expect(writeConfig).toEqual(same);
            expect(writeConfig).not.toBe(same);
        }
    });

    it("removeWriteConfig removes an entry once and reports false thereafter", () => {
        const config = LoggerConfig.create("/tmp/x");
        config.appendWriteConfig({name: "a", console: false});
        config.appendWriteConfig({name: "b", console: true});

        expect(config.removeWriteConfig("b")).toBe(true);
        expect(config.removeWriteConfig("b")).toBe(false);
        expect(config.writeConfig("b")).toBeUndefined();
    });

    it("clone() deep-copies write configs so mutating the original does not affect the clone", () => {
        const config = LoggerConfig.create("/tmp/x");
        config.appendWriteConfig({name: "a", console: false});

        const cloned = config.clone();
        config.writeConfig("a")!.history = 99;

        expect(cloned.writeConfig("a")!.history).toBe(30);
        expect(cloned.defaultWriteConfig).toEqual(config.defaultWriteConfig);
    });

    it("logFileDir updates the default path and future entries, but not entries added earlier", () => {
        const config = LoggerConfig.create("/tmp/x");
        config.appendWriteConfig({name: "a", console: false});

        config.logFileDir = "/tmp/y";

        expect(config.defaultWriteConfig.path).toBe("/tmp/y");
        expect(config.writeConfig("a")?.path).toBe("/tmp/x");

        config.appendWriteConfig({name: "d", console: true});
        expect(config.writeConfig("d")?.path).toBe("/tmp/y");
    });
});

import fs from "fs/promises";
import path from "path";
import LoggerFactory from "../../../../src/util/logger/LoggerFactory";
import {withConfigurationServer} from "./configuration-revision-fixture";

// #267 — 서버 설정의 logLevel 을 관리자 API 로 바꾸면 다시 시작하지 않고 바로 로그 출력에 적용한다.
jest.setTimeout(60_000);

const writerLevels = (): string[] => [...(LoggerFactory as any)._logWriterMap.values()].map((writer: any) => writer.level);

describe("server option logLevel (#267)", () => {
    afterEach(() => LoggerFactory.setLevel(undefined));

    test.each(["PUT", "POST"])("%s /api/serverOption applies the level to every log writer at once (REQ-1·REQ-2)", async (method) => withConfigurationServer(async ({request, snapshot, store}) => {
        const read = await snapshot();
        expect(read.serverOption.logLevel).toBe("info");
        const saved = await request(method, "/api/serverOption", {...read.serverOption, logLevel: "debug", expectedRevision: read.revisionState.currentRevision});
        expect(saved.statusCode).toBe(200);
        expect(store.serverOption.logLevel).toBe("debug");
        expect(new Set(writerLevels())).toEqual(new Set(["debug"]));

        const again = await snapshot();
        const warn = await request(method, "/api/serverOption", {...again.serverOption, logLevel: "warn", expectedRevision: again.revisionState.currentRevision});
        expect(warn.statusCode).toBe(200);
        expect(new Set(writerLevels())).toEqual(new Set(["warn"]));
    }));

    // 적용 중 다른 범위가 실패하면 저장을 되돌린다. applyServerOption 은 그 전에 레벨을 바꾸므로 되돌릴 때 레벨도 돌아가야 한다.
    // (configuration-rollback 테스트처럼 실제 적용은 그대로 하고 결과만 실패로 돌려준다.)
    test("a save rolled back after a runtime apply failure also restores the running level", async () => withConfigurationServer(async ({request, snapshot, store, tunnel}) => {
        const read = await snapshot();
        expect((await request("POST", "/api/serverOption", {...read.serverOption, logLevel: "warn",
            expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
        expect(new Set(writerLevels())).toEqual(new Set(["warn"]));
        const baseline = await snapshot();
        const apply = tunnel.applyServerOption;
        let applied = 0;
        tunnel.applyServerOption = async (...args: any[]) => {
            await apply.apply(tunnel, args);
            applied++;
            return {success: false, partial: true, failedScopes: ["memory-limit"], restartRequiredScopes: [], warnings: []};
        };
        try {
            const failed = await request("POST", "/api/serverOption", {...baseline.serverOption, logLevel: "debug",
                expectedRevision: baseline.revisionState.currentRevision});
            expect(failed.statusCode).toBe(400);
            expect(applied).toBe(1);
            expect(store.serverOption.logLevel).toBe("warn");
            expect(new Set(writerLevels())).toEqual(new Set(["warn"]));
        } finally { tunnel.applyServerOption = apply; }
    }));

    test("a wrong logLevel is 400 and leaves server.yaml and the running level unchanged (AC-2)", async () => withConfigurationServer(async ({request, snapshot, store, root}) => {
        const read = await snapshot();
        const file = path.join(root.rootDir, "config", "server.yaml");
        const before = await fs.readFile(file, "utf8");
        const levels = writerLevels();
        const rejected = await request("POST", "/api/serverOption", {...read.serverOption, logLevel: "verbose", expectedRevision: read.revisionState.currentRevision});
        expect(rejected.statusCode).toBe(400);
        expect(JSON.parse(rejected.body).message).toBe("logLevel must be one of error, warn, info, debug");
        expect(await fs.readFile(file, "utf8")).toBe(before);
        expect(store.serverOption.logLevel).toBe("info");
        expect(store.revisionState.currentRevision).toBe(read.revisionState.currentRevision);
        expect(writerLevels()).toEqual(levels);
    }));
});

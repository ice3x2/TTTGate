import * as fs from "fs";
import * as path from "path";
import Environment from "../../../src/Environment";
import {applyStartupRuntimeOptions} from "../../../src/server/ServerApp";
import {AdmissionController} from "../../../src/server/security/AdmissionController";
import {ServerOption} from "../../../src/types/TunnelingOption";
import LoggerFactory from "../../../src/util/logger/LoggerFactory";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

// #327 REQ-14 · AC-5b: 서버가 시작할 때 거절 로그를 켜고, 거절이 없어도 기한이 지난 파일을 지운다.
describe("applyStartupRuntimeOptions starts the denial log", () => {
    let testRoot: TestRoot;
    beforeEach(async () => {
        testRoot = await createTestRoot("denial-log-startup");
        applyTestRoot(testRoot.rootDir);
        AdmissionController.resetForTest();
    });
    afterEach(async () => {
        AdmissionController.resetForTest();
        LoggerFactory.setLevel(undefined);
        await cleanupTestRoot(testRoot);
    });

    test("uses the default of 20 days and removes an expired file at once", () => {
        const date = new Date();
        date.setDate(date.getDate() - 20);
        const expired = `denial-${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}.log`;
        fs.mkdirSync(Environment.path.logDir, {recursive: true});
        fs.writeFileSync(path.join(Environment.path.logDir, expired), "old\n");

        applyStartupRuntimeOptions({} as ServerOption);

        expect(AdmissionController.instance.denialFileLog?.enabled).toBe(true);
        expect(fs.existsSync(path.join(Environment.path.logDir, expired))).toBe(false);
    });

    test("a retention of 0 or less keeps the denial log off", () => {
        applyStartupRuntimeOptions({denialLogRetentionDays: -1} as ServerOption);
        expect(AdmissionController.instance.denialFileLog?.enabled).toBe(false);
    });
});

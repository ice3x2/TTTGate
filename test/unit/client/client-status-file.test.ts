import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {CLIENT_STATUS_FILE_NAME, ClientConnectionTracker, readClientStatus, STABLE_CONNECTION_MS, writeClientStatus}
    from "../../../src/client/ClientStatusFile";

// #322 REQ-15 클라이언트 연결 상태 파일
describe("client connection status", () => {
    let now = 1_000_000;
    const tracker = () => new ClientConnectionTracker(() => now, 77);

    test("connecting, connected and reconnecting are recorded with their start time", () => {
        const t = tracker();
        expect(t.connecting()).toEqual({state: "connecting", since: now, failures: 0, pid: 77});
        now += 100;
        expect(t.connected()).toEqual({state: "connected", since: now, failures: 0, pid: 77});
        now += STABLE_CONNECTION_MS;
        expect(t.closed()).toEqual({state: "reconnecting", since: now, failures: 0, pid: 77});
    });

    test("REQ-2b a connection that closes before it is stable counts as a failure, even after 'connected'", () => {
        // 클라이언트는 인증 결과를 기다리지 않고 '연결됨'이 된다. 서버가 곧바로 끊으면(인증 거부 등) 실패로 센다.
        const t = tracker();
        t.connecting();
        expect(t.closed().failures).toBe(1);
        t.connecting();
        t.connected();
        now += STABLE_CONNECTION_MS - 1;
        expect(t.closed().failures).toBe(2);
        t.connecting();
        expect(t.connected().failures).toBe(2);
        now += STABLE_CONNECTION_MS;
        expect(t.closed().failures).toBe(0);
    });

    test("the file is written and read back; a missing or broken file reads as undefined", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-status-"));
        try {
            expect(readClientStatus(dir)).toBeUndefined();
            const status = {state: "connected" as const, since: 5, failures: 0, pid: 9};
            writeClientStatus(dir, status);
            expect(readClientStatus(dir)).toEqual(status);
            fs.writeFileSync(path.join(dir, CLIENT_STATUS_FILE_NAME), "{broken");
            expect(readClientStatus(dir)).toBeUndefined();
            fs.writeFileSync(path.join(dir, CLIENT_STATUS_FILE_NAME), JSON.stringify({state: "odd", since: 1, failures: 0, pid: 1}));
            expect(readClientStatus(dir)).toBeUndefined();
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });

    test("a write into a missing folder does not throw", () => {
        expect(() => writeClientStatus(path.join(os.tmpdir(), "no-such-dir-322", "x"), {state: "connecting", since: 1, failures: 0, pid: 1})).not.toThrow();
    });

    test("a failed rename leaves no temporary file behind", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-status-rename-"));
        try {
            // 상태 파일 이름에 폴더가 있으면 이름 바꾸기가 실패한다.
            fs.mkdirSync(path.join(dir, CLIENT_STATUS_FILE_NAME));
            writeClientStatus(dir, {state: "connected", since: 1, failures: 0, pid: 4});
            expect(fs.readdirSync(dir)).toEqual([CLIENT_STATUS_FILE_NAME]);
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
});

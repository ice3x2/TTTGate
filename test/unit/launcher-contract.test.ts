import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {buildStatus} from "../../src/StatusCommand";
import {writeClientStatus} from "../../src/client/ClientStatusFile";

// #322: 런처(Rust)는 CLI 의 JSON 을 읽는다. 그 모양을 launcher/contract 에 고정해 두고,
// 이 테스트(TS 쪽)와 launcher/src-tauri/src/cli.rs 의 테스트(Rust 쪽)가 같은 파일을 본다.
// 한쪽만 바뀌면 둘 중 하나가 실패한다.
jest.mock("../../src/client/ClientEnrollment", () => ({requestEnrollment: jest.fn()}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {requestEnrollment} = require("../../src/client/ClientEnrollment");
import {runClientJoin} from "../../src/client/ClientJoin";

const contract = (name: string) =>
    JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../launcher/contract", name), "utf-8"));

describe("launcher JSON contract", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-contract-"));
        fs.mkdirSync(path.join(dir, "bin"));
        fs.mkdirSync(path.join(dir, "config"));
    });
    afterEach(() => fs.rmSync(dir, {recursive: true, force: true}));

    test("status of a running client", () => {
        writeClientStatus(path.join(dir, "bin"), {state: "reconnecting", since: 1793800000000, failures: 3, pid: 4321});
        const status = buildStatus({findRunning: () => ({pid: 4321, mode: "client", daemon: true}),
            binDir: path.join(dir, "bin"), configDir: path.join(dir, "config"), version: "2.0.1"});
        expect(status).toEqual(contract("status-client.json"));
    });

    test("status of a running server that waits for the bootstrap", () => {
        fs.writeFileSync(path.join(dir, "config", "server.yaml"), "adminPort: 9300\nadminTls: true\nadminBindHost: 127.0.0.1\n");
        fs.writeFileSync(path.join(dir, "config", ".bootstrap-token"), "t");
        const status = buildStatus({findRunning: () => ({pid: 99, mode: "server", daemon: false}),
            binDir: path.join(dir, "bin"), configDir: path.join(dir, "config"), version: "2.0.1"});
        // 토큰 파일 경로는 설치 폴더마다 다르므로 계약 파일에는 자리 표시 값을 둔다.
        expect({...status, server: {...status.server!, bootstrapTokenFile: "<token file>"}}).toEqual(contract("status-server.json"));
    });

    test("join results", async () => {
        const out: string[] = [];
        const io = {configDir: path.join(dir, "config"), out: (line: string) => out.push(line), err: () => {}, readInput: () => ""};
        (requestEnrollment as jest.Mock).mockResolvedValue({ok: false, category: "rejected", message: "m"});
        await runClientJoin("gw.example:9126", {code: "7Q4K-M2XP-AB01", json: ""}, io);
        (requestEnrollment as jest.Mock).mockResolvedValue({ok: true, payload: {clientId: "edge", clientSecret: "s", ca: "ca", serverName: "n"}});
        await runClientJoin("gw.example:9126", {code: "7Q4K-M2XP-AB01", json: ""}, io);
        expect(out.map((line) => JSON.parse(line))).toEqual([contract("join-failed.json"), contract("join-ok.json")]);
    });
});

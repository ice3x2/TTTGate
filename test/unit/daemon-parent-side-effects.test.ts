import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import YAML from "yaml";
import Environment from "../../src/Environment";
import {resolveClientCliOptions} from "../../src/client/ClientApp";
import {validateServerCliOptions} from "../../src/server/ServerApp";

const CA_PEM = "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ0FfUEVNX0ZJWFRVUkU=\n-----END CERTIFICATE-----\n";

/** 디렉터리 안의 모든 파일 경로와 내용·수정 시각. */
const snapshot = (dir: string): string => JSON.stringify(fs.readdirSync(dir, {recursive: true}).map(String).sort()
    .map((name) => {
        const file = path.join(dir, name);
        const stat = fs.statSync(file);
        return [name, stat.isFile() ? fs.readFileSync(file, "utf-8") : "<dir>", stat.mtimeMs];
    }));

// #222 REQ-2 — 데몬 부모의 검증은 통과하는 입력(-save, -reset 포함)에서도 파일 시스템을 바꾸지 않는다(#207 REQ-2).
describe("daemon parent validation has no side effects (#222)", () => {
    let root: string;
    const cwd = process.cwd();
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-parent-"));
        fs.mkdirSync(path.join(root, "config"));
        fs.mkdirSync(path.join(root, "bin"));
        Environment.configure({rootDir: root});
        process.chdir(root);
    });
    afterEach(() => {
        process.chdir(cwd);
        Environment.reset();
        fs.rmSync(root, {recursive: true, force: true});
    });

    test("client: a passing -save run leaves every file untouched", () => {
        fs.writeFileSync(path.join(root, "ca.pem"), CA_PEM);
        fs.writeFileSync(path.join(root, "config", "client.yaml"), YAML.stringify({host: "old", clientId: "edge"}));
        const before = snapshot(root);
        const result = resolveClientCliOptions({save: "", addr: "gw:9300", ca: "ca.pem", clientSecret: "s"});
        expect(result.ok).toBe(true);
        expect(snapshot(root)).toBe(before);
        expect(fs.existsSync(path.join(root, "logs"))).toBe(false);
    });

    test("server: a passing -reset run leaves config and certificates in place", () => {
        fs.writeFileSync(path.join(root, "config", "server.yaml"), YAML.stringify({key: "k", port: 9126, adminPort: 9300,
            adminTls: true, adminBindHost: "127.0.0.1", tunnelingOptions: []}));
        fs.writeFileSync(path.join(root, "config", "decoy.txt"), "keep");
        const before = snapshot(root);
        expect(validateServerCliOptions({reset: "", adminPort: "9301", keepAlive: "1000"})).toEqual({ok: true});
        expect(snapshot(root)).toBe(before);
    });
});

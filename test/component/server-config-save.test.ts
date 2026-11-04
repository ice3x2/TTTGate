import * as fs from "fs";
import * as path from "path";
import YAML from "yaml";
import Environment from "../../src/Environment";
import ServerOptionStore from "../../src/server/ServerOptionStore";
import {saveServerConfig} from "../../src/server/ServerConfigCommand";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../helpers/runtime";

// #322 REQ-17 TTTGate server config save
describe("server config save", () => {
    let root: TestRoot;
    let out: string[];
    let err: string[];
    let running: boolean;
    const yamlFile = () => path.join(Environment.path.configDir, "server.yaml");
    const stored = () => YAML.parse(fs.readFileSync(yamlFile(), "utf-8"));
    const save = (cli: {[key: string]: string}) => {
        ServerOptionStore.resetForTest();
        return saveServerConfig(cli, {out: (line) => out.push(line), err: (line) => err.push(line)}, {isServerRunning: () => running});
    };

    beforeEach(async () => {
        root = await createTestRoot("server-config-save");
        applyTestRoot(root.rootDir);
        out = [];
        err = [];
        running = false;
    });
    afterEach(async () => {
        ServerOptionStore.resetForTest();
        await cleanupTestRoot(root);
    });

    test("AC-10 the given values are validated and saved; the others stay", () => {
        expect(save({adminPort: "9400", adminAllowedOrigins: " https://gw.example:9400 , https://b.example ", controlPort: "9127",
            controlTls: "true", controlProtocolMode: "mixed"})).toBe(0);
        expect(stored()).toMatchObject({adminPort: 9400, adminBindHost: "127.0.0.1", adminTls: true,
            adminAllowedOrigins: ["https://gw.example:9400", "https://b.example"], port: 9127, tls: true, controlProtocolMode: "mixed"});
        expect(out).toEqual([`Saved ${yamlFile()}`]);
        const key = stored().key;

        expect(save({adminPort: "9500"})).toBe(0);
        expect(stored()).toMatchObject({adminPort: 9500, port: 9127, tls: true, key, adminAllowedOrigins: ["https://gw.example:9400", "https://b.example"]});
        expect(save({adminAllowedOrigins: ""})).toBe(0);
        expect(stored().adminAllowedOrigins).toEqual([]);
    });

    test("AC-10 nothing is saved while the server runs", () => {
        expect(save({adminPort: "9400"})).toBe(0);
        const before = fs.readFileSync(yamlFile(), "utf-8");
        running = true;
        expect(save({adminPort: "9600"})).toBe(75);
        expect(fs.readFileSync(yamlFile(), "utf-8")).toBe(before);
        expect(err.join("\n")).toContain("TTTGate stop");
    });

    test("AC-10 a non-loopback admin address needs -allowLegacyAdminRemote and exits 77 so the launcher can ask", () => {
        expect(save({adminPort: "9400"})).toBe(0);
        const before = fs.readFileSync(yamlFile(), "utf-8");
        expect(save({adminBindHost: "0.0.0.0"})).toBe(77);
        expect(fs.readFileSync(yamlFile(), "utf-8")).toBe(before);
        expect(err.join("\n")).toContain("-allowLegacyAdminRemote");
        expect(save({adminBindHost: "0.0.0.0", allowLegacyAdminRemote: ""})).toBe(0);
        expect(stored().adminBindHost).toBe("0.0.0.0");
        expect(save({adminBindHost: "::1"})).toBe(0);
    });

    test("AC-10 a server.yaml with admin TLS off is not saved: the server would refuse to start without -allowLegacyAdminHttp", () => {
        expect(save({adminPort: "9400"})).toBe(0);
        // 관리 화면에서 HTTP 로 바꾼 경우와 같다. 서버 시작 경로와 같은 정책(evaluateAdminSecurityPolicy)으로 판단한다.
        const yaml = stored();
        yaml.adminTls = false;
        fs.writeFileSync(yamlFile(), YAML.stringify(yaml));
        const before = fs.readFileSync(yamlFile(), "utf-8");
        expect(save({controlPort: "9127"})).toBe(1);
        expect(fs.readFileSync(yamlFile(), "utf-8")).toBe(before);
        expect(err.join("\n")).toContain("admin TLS is disabled");
        expect(err.join("\n")).toContain("adminTls");
    });

    test("AC-10 wrong values are not saved", () => {
        expect(save({adminPort: "9400"})).toBe(0);
        const before = fs.readFileSync(yamlFile(), "utf-8");
        for(const cli of <Array<{[key: string]: string}>>[{adminPort: "70000"}, {controlPort: "0"}, {controlProtocolMode: "bogus"}, {adminAllowedOrigins: "ftp://x"},
            {controlProtocolMode: "mtls-strict", controlTls: "false"}]) {
            err = [];
            expect(save(cli)).toBe(1);
            expect(err.join("")).not.toBe("");
            expect(fs.readFileSync(yamlFile(), "utf-8")).toBe(before);
        }
    });
});

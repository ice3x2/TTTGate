import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import YAML from "yaml";
import Environment from "../../../src/Environment";
import {__testInternals} from "../../../src/client/ClientApp";

const CA_PEM = "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ0FfUEVNX0ZJWFRVUkU=\n-----END CERTIFICATE-----\n";

describe("-save (#201 REQ-5, #209 REQ-5·6, #210 REQ-4)", () => {
    let root: string;
    let cwd: string;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-save-"));
        fs.mkdirSync(path.join(root, "config"));
        Environment.configure({rootDir: root});
        cwd = process.cwd();
    });
    afterEach(() => {
        process.chdir(cwd);
        Environment.reset();
        fs.rmSync(root, {recursive: true, force: true});
    });
    const yamlPath = () => path.join(root, "config", "client.yaml");

    test("writes the CA path as an absolute path, the secret from a file, and name only", () => {
        process.chdir(root);
        fs.writeFileSync(path.join(root, "ca.pem"), CA_PEM);
        fs.writeFileSync(path.join(root, "secret.txt"), "s3cret\n");
        __testInternals.loadClientOption({save: "", addr: "tls://gw:9300", ca: "ca.pem", clientSecretFile: "secret.txt", displayName: "edge"});
        const saved = YAML.parse(fs.readFileSync(yamlPath(), "utf-8"));
        // 명령줄 상대 경로는 다음 실행에서도 같은 파일을 찾도록 절대 경로로 저장한다(리뷰 M3).
        expect(saved).toMatchObject({host: "gw", port: 9300, tls: true, ca: path.resolve(process.cwd(), "ca.pem"), clientSecret: "s3cret", name: "edge"});
        expect(saved.displayName).toBeUndefined();
        expect(saved.clientSecretFile).toBeUndefined();
    });

    (process.platform === "win32" ? test.skip : test)("client.yaml is 0600 after -save, also when it already existed", () => {
        fs.writeFileSync(yamlPath(), "host: old\n", {mode: 0o644});
        __testInternals.loadClientOption({save: "", addr: "gw"});
        expect(fs.statSync(yamlPath()).mode & 0o777).toBe(0o600);
    });
});

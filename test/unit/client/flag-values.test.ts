import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import YAML from "yaml";
import CLI from "../../../src/util/CLI";
import Environment from "../../../src/Environment";
import {__testInternals} from "../../../src/client/ClientApp";
import {resolveClientOption} from "../../../src/client/ClientOptionResolver";
import {runClientJoin} from "../../../src/client/ClientJoin";
import {legacyControlAuthFromCli} from "../../../src/server/ServerCliOptions";

// #218 — 파서가 받는 거짓 값(false·0·no·off)을 플래그를 읽는 모든 곳이 거짓으로 본다.
const FALSE_WORDS = ["false", "0", "no", "off", "OFF"];
const TRUE_WORDS = ["", "true", "1", "yes", "on"];

describe("flag values (#218)", () => {
    let root: string;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-flags-"));
        fs.mkdirSync(path.join(root, "config"));
    });
    afterEach(() => {
        Environment.reset();
        fs.rmSync(root, {recursive: true, force: true});
    });

    test.each(FALSE_WORDS)("-allowLegacyControlAuth %s turns legacy auth off", (word) => {
        expect(legacyControlAuthFromCli({allowLegacyControlAuth: word})).toBe(false);
    });
    test.each(TRUE_WORDS)("-allowLegacyControlAuth '%s' turns legacy auth on", (word) => {
        expect(legacyControlAuthFromCli({allowLegacyControlAuth: word})).toBe(true);
    });
    test("no -allowLegacyControlAuth leaves server.yaml alone", () => {
        expect(legacyControlAuthFromCli({})).toBeUndefined();
    });

    test.each(FALSE_WORDS)("-save %s does not write client.yaml", (word) => {
        Environment.configure({rootDir: root});
        __testInternals.loadClientOption({save: word, addr: "gw"});
        expect(fs.existsSync(path.join(root, "config", "client.yaml"))).toBe(false);
    });

    test.each(FALSE_WORDS)("--force %s keeps an existing client.yaml (78)", async (word) => {
        const configDir = path.join(root, "config");
        fs.writeFileSync(path.join(configDir, "client.yaml"), "host: old\n");
        const code = await runClientJoin("127.0.0.1:1", {code: "0000-0000-0000", force: word}, {configDir, out: () => {}, err: () => {}});
        expect(code).toBe(78);
        expect(fs.readFileSync(path.join(configDir, "client.yaml"), "utf-8")).toBe("host: old\n");
    });

    test.each(FALSE_WORDS)("--yes-insecure %s does not accept insecure client.yaml fields", (word) => {
        const configDir = path.join(root, "config");
        fs.writeFileSync(path.join(configDir, "client.yaml"), YAML.stringify({host: "gw", allowInsecureTls: true}));
        for(const name of ["yes-insecure", "yesInsecure"]) {
            const result = resolveClientOption({cli: {[name]: word}, env: {}, configDir, cwd: root});
            expect(result.ok).toBe(false);
            if(!result.ok) expect(result.exitCode).toBe(78);
        }
    });

    test("REQ-3 a flag with an attached value that is not a boolean word is a command-line error", () => {
        expect(CLI.parseCommandLine(["client", "-save=maybe"]).errors).toEqual([expect.stringContaining("-save")]);
        expect(CLI.parseCommandLine(["server", "-reset=perhaps"]).errors).toEqual([expect.stringContaining("-reset")]);
        expect(CLI.parseCommandLine(["client", "-save=off"]).errors).toEqual([]);
        expect(CLI.parseCommandLine(["client", "-tls=TRUE"]).errors).toEqual([]);
    });
});

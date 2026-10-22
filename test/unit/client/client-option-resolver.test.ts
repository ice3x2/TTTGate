import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import YAML from "yaml";
import {resolveClientOption, ResolveClientOptionResult} from "../../../src/client/ClientOptionResolver";

const CA_PEM = "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ0FfUEVNX0ZJWFRVUkU=\n-----END CERTIFICATE-----\n";
const KEY_PEM = "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----\n";

let root: string;
let configDir: string;
let cwd: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-resolver-"));
    configDir = path.join(root, "config");
    cwd = path.join(root, "work");
    fs.mkdirSync(configDir);
    fs.mkdirSync(cwd);
});

afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

const writeYaml = (value: object) => fs.writeFileSync(path.join(configDir, "client.yaml"), YAML.stringify(value));
const resolve = (cli: {[key: string]: string} = {}, env: {[key: string]: string} = {}): ResolveClientOptionResult =>
    resolveClientOption({cli, env, configDir, cwd});
const ok = (result: ResolveClientOptionResult) => {
    if(!result.ok) throw new Error(`expected success, got ${result.exitCode}: ${result.message}`);
    return result;
};
const fail = (result: ResolveClientOptionResult) => {
    if(result.ok) throw new Error("expected failure");
    return result;
};
const warnings = (result: ResolveClientOptionResult) => ok(result).notices.filter(n => n.level === "warn").map(n => n.message);
const infos = (result: ResolveClientOptionResult) => ok(result).notices.filter(n => n.level === "info").map(n => n.message);

describe("#201 -ca / -cert / -privateKey accept a path or PEM text", () => {
    test("REQ-1 PEM text is used as is, even with surrounding spaces", () => {
        expect(ok(resolve({ca: `  ${CA_PEM}  `})).option.ca).toBe(CA_PEM.trim());
    });

    test("REQ-2 a command-line path is read relative to the working directory", () => {
        fs.writeFileSync(path.join(cwd, "ca.pem"), CA_PEM);
        expect(ok(resolve({ca: "ca.pem"})).option.ca).toBe(CA_PEM);
        expect(ok(resolve({ca: path.join(cwd, "ca.pem")})).option.ca).toBe(CA_PEM);
    });

    test("REQ-2 a client.yaml path is read relative to the config directory", () => {
        fs.writeFileSync(path.join(configDir, "server-ca.pem"), CA_PEM);
        writeYaml({host: "gw", tls: true, ca: "server-ca.pem"});
        expect(ok(resolve()).option.ca).toBe(CA_PEM);
    });

    test("REQ-3 a missing file or a file without a certificate fails with 78 and names the path", () => {
        const missing = fail(resolve({ca: "nope.pem"}));
        expect(missing.exitCode).toBe(78);
        expect(missing.message).toContain(path.join(cwd, "nope.pem"));
        fs.writeFileSync(path.join(cwd, "empty.pem"), "not a certificate");
        expect(fail(resolve({ca: "empty.pem"})).exitCode).toBe(78);
    });

    test("REQ-4 cert needs a CERTIFICATE block and privateKey needs a PRIVATE KEY block", () => {
        fs.writeFileSync(path.join(cwd, "client.crt"), CA_PEM);
        fs.writeFileSync(path.join(cwd, "client.key"), KEY_PEM);
        const result = ok(resolve({cert: "client.crt", privateKey: "client.key"}));
        expect(result.option.cert).toBe(CA_PEM);
        expect(result.option.privateKey).toBe(KEY_PEM);
        expect(fail(resolve({privateKey: "client.crt"})).exitCode).toBe(78);
        expect(fail(resolve({cert: "client.key"})).exitCode).toBe(78);
    });

    test("REQ-5 -save keeps what the user gave (the path), not the file contents", () => {
        fs.writeFileSync(path.join(cwd, "ca.pem"), CA_PEM);
        expect(ok(resolve({ca: "ca.pem"})).saveOption.ca).toBe("ca.pem");
    });

    test("REQ-6 errors about the private key never include its contents", () => {
        fs.writeFileSync(path.join(cwd, "bad.key"), "SECRET-MATERIAL-WITHOUT-HEADER");
        expect(fail(resolve({privateKey: "bad.key"})).message).not.toContain("SECRET-MATERIAL");
        expect(fail(resolve({privateKey: "SECRET-INLINE-VALUE"})).message).not.toContain("SECRET-INLINE-VALUE");
    });
});

describe("#202 -addr", () => {
    test("REQ-1/2 IPv6 in brackets is split into host and port", () => {
        const result = ok(resolve({addr: "[::1]:9200"}));
        expect(result.option.host).toBe("::1");
        expect(result.option.port).toBe(9200);
    });

    test("REQ-3 a bad port on the command line fails with 2", () => {
        for(const addr of ["host:", "host:x", "host:70000"]) {
            const result = fail(resolve({addr}));
            expect(result.exitCode).toBe(2);
            expect(result.message).toContain(addr);
        }
    });

    test("a bad port in client.yaml still falls back with a warning", () => {
        writeYaml({host: "gw", port: 70000});
        const result = ok(resolve());
        expect(result.option.port).toBe(9126);
        expect(warnings(result).join("\n")).toContain("port");
    });
});

describe("#205 TLS options turn TLS on", () => {
    test("REQ-2 a TLS option on the command line turns TLS on, even over tls:false in client.yaml", () => {
        expect(ok(resolve({serverName: "gw"})).option.tls).toBe(true);
        writeYaml({host: "gw", tls: false});
        const result = ok(resolve({ca: CA_PEM}));
        expect(result.option.tls).toBe(true);
        expect(infos(result).join("\n")).toContain("TLS");
        expect(result.saveOption.tls).toBe(true);
    });

    test("REQ-3 a TLS option with an explicit -tls false or tcp:// fails with 2", () => {
        const result = fail(resolve({tls: "false", ca: CA_PEM}));
        expect(result.exitCode).toBe(2);
        expect(result.message).toContain("-ca");
        expect(fail(resolve({addr: "tcp://gw", serverName: "gw"})).exitCode).toBe(2);
    });

    test("REQ-4 TLS options only in client.yaml with tls:false stay plain text with a warning", () => {
        writeYaml({host: "gw", tls: false, serverName: "gw"});
        const result = ok(resolve());
        expect(result.option.tls).toBe(false);
        expect(warnings(result).join("\n")).toContain("serverName");
    });

    test("no TLS option and no -tls stays plain text without notices about TLS", () => {
        const result = ok(resolve({addr: "gw"}));
        expect(result.option.tls).toBe(false);
        expect(result.notices.map(n => n.message).join("\n")).not.toMatch(/TLS/);
    });
});

describe("#206 -bufferLimit", () => {
    test.each(["-1", "16", "256", "1048576"])("accepts %s", (value) => {
        expect(ok(resolve({bufferLimit: value})).option.globalMemCacheLimit).toBe(Number(value));
    });

    test.each(["abc", "-2", "0", "15", "1048577", "12.5"])("rejects %s with 2", (value) => {
        const result = fail(resolve({bufferLimit: value}));
        expect(result.exitCode).toBe(2);
        expect(result.message).toContain(value);
        expect(result.message).toContain("16..1048576");
    });

    test.each([0, 1048577])("client.yaml value %s falls back to 128 with a warning", (value) => {
        writeYaml({host: "gw", globalMemCacheLimit: value});
        const result = ok(resolve());
        expect(result.option.globalMemCacheLimit).toBe(128);
        expect(warnings(result).join("\n")).toContain("globalMemCacheLimit");
    });
});

describe("#209 secrets from the environment or a file", () => {
    test("REQ-1 TTTGATE_CLIENT_SECRET is used", () => {
        expect(ok(resolve({}, {TTTGATE_CLIENT_SECRET: "from-env"})).option.clientSecret).toBe("from-env");
    });

    test("REQ-2 -clientSecretFile is read and trimmed; a missing or empty file fails with 78", () => {
        fs.writeFileSync(path.join(cwd, "secret.txt"), "  from-file\n");
        expect(ok(resolve({clientSecretFile: "secret.txt"})).option.clientSecret).toBe("from-file");
        expect(fail(resolve({clientSecretFile: "none.txt"})).exitCode).toBe(78);
        fs.writeFileSync(path.join(cwd, "blank.txt"), " \n");
        expect(fail(resolve({clientSecretFile: "blank.txt"})).exitCode).toBe(78);
    });

    test("REQ-3 precedence is command line > file > environment > client.yaml, and both command-line forms fail with 2", () => {
        writeYaml({host: "gw", clientSecret: "from-yaml"});
        fs.writeFileSync(path.join(cwd, "secret.txt"), "from-file");
        expect(ok(resolve()).option.clientSecret).toBe("from-yaml");
        expect(ok(resolve({}, {TTTGATE_CLIENT_SECRET: "from-env"})).option.clientSecret).toBe("from-env");
        expect(ok(resolve({clientSecretFile: "secret.txt"}, {TTTGATE_CLIENT_SECRET: "from-env"})).option.clientSecret).toBe("from-file");
        expect(ok(resolve({clientSecret: "from-cli"}, {TTTGATE_CLIENT_SECRET: "from-env"})).option.clientSecret).toBe("from-cli");
        expect(fail(resolve({clientSecret: "a", clientSecretFile: "secret.txt"})).exitCode).toBe(2);
    });

    test("REQ-4 a secret on the command line warns without the value", () => {
        const text = warnings(resolve({clientSecret: "visible-value", key: "legacy-value"})).join("\n");
        expect(text).toContain("-clientSecret");
        expect(text).toContain("-key");
        expect(text).toContain("TTTGATE_CLIENT_SECRET");
        expect(text).not.toContain("visible-value");
        expect(text).not.toContain("legacy-value");
    });

    test("REQ-5 -save stores a secret from the environment or a file but not the file path", () => {
        fs.writeFileSync(path.join(cwd, "secret.txt"), "from-file");
        const fromFile = ok(resolve({clientSecretFile: "secret.txt"}));
        expect(fromFile.saveOption.clientSecret).toBe("from-file");
        expect(JSON.stringify(fromFile.saveOption)).not.toContain("secret.txt");
        expect(ok(resolve({}, {TTTGATE_CLIENT_SECRET: "from-env"})).saveOption.clientSecret).toBe("from-env");
    });
});

describe("#210 -name and -displayName", () => {
    test("REQ-2 -displayName is an alias of -name with a deprecation warning; different values fail with 2", () => {
        const alias = ok(resolve({displayName: "edge-1"}));
        expect(alias.option.name).toBe("edge-1");
        expect(warnings(alias).join("\n")).toContain("-displayName");
        expect(ok(resolve({name: "edge-1", displayName: "edge-1"})).option.name).toBe("edge-1");
        expect(fail(resolve({name: "a", displayName: "b"})).exitCode).toBe(2);
    });

    test("REQ-3 client.yaml displayName alone becomes the name; both and different keep name with a warning", () => {
        writeYaml({host: "gw", displayName: "Only Display"});
        expect(ok(resolve()).option.name).toBe("Only Display");
        writeYaml({host: "gw", name: "client-a", displayName: "Client A"});
        const both = ok(resolve());
        expect(both.option.name).toBe("client-a");
        expect(warnings(both).join("\n")).toContain("displayName");
    });

    test("REQ-1/4 the resolved option and -save carry only name", () => {
        const result = ok(resolve({displayName: "edge-1"}));
        expect(result.option.displayName).toBeUndefined();
        expect("displayName" in result.saveOption).toBe(false);
        expect(result.saveOption.name).toBe("edge-1");
    });
});

describe("#211 -addr schemes", () => {
    test("REQ-1 tls:// turns TLS on and tcp:// turns it off", () => {
        expect(ok(resolve({addr: "tls://gw.example.com:9300"})).option).toMatchObject({host: "gw.example.com", port: 9300, tls: true});
        writeYaml({host: "gw", tls: true});
        expect(ok(resolve({addr: "tcp://gw2"})).option).toMatchObject({host: "gw2", tls: false});
    });

    test("REQ-3 a scheme that disagrees with -tls fails with 2", () => {
        expect(fail(resolve({addr: "tcp://gw", tls: ""})).exitCode).toBe(2);
        expect(fail(resolve({addr: "tls://gw", tls: "false"})).exitCode).toBe(2);
    });

    test("REQ-4 another scheme or a path fails with 2", () => {
        expect(fail(resolve({addr: "http://gw"})).exitCode).toBe(2);
        expect(fail(resolve({addr: "tls://gw/x"})).exitCode).toBe(2);
    });

    test("REQ-5 -save stores host, port and tls", () => {
        const save = ok(resolve({addr: "tls://[::1]:9300"})).saveOption;
        expect(save).toMatchObject({host: "::1", port: 9300, tls: true});
        expect("addr" in save).toBe(false);
    });
});

describe("client.yaml insecure gate keeps working", () => {
    test("insecure fields without --yes-insecure fail with 78; with it they load and are never saved", () => {
        writeYaml({host: "gw", allowInsecureTls: true});
        const refused = fail(resolve());
        expect(refused.exitCode).toBe(78);
        expect(refused.message).toContain("REFUSE-INSECURE-YAML");
        const accepted = ok(resolve({"yes-insecure": ""}));
        expect(accepted.option.allowInsecureTls).toBe(true);
        expect("allowInsecureTls" in accepted.saveOption).toBe(false);
    });
});

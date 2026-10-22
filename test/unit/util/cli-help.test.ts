import {renderHelp, renderVersion} from "../../../src/util/CliHelp";
import {CLI_OPTIONS} from "../../../src/util/CliSpec";

/** 각 줄 맨 앞의 옵션 이름만 모은다(설명 문장 안에 나오는 옵션 이름은 세지 않는다). */
const optionTokens = (text: string): string[] => text.split("\n")
    .filter(line => /^\s+-/.test(line))
    .flatMap(line => line.trim().split(/\s{2,}/)[0].split(/,\s*/).map(token => token.split(" ")[0]));

describe("CLI help (#208)", () => {
    test("REQ-1 top-level help lists the modes and how to get mode help", () => {
        const text = renderHelp("none", false);
        expect(text).toContain("Usage: TTTGate <server|client|stop> [options]");
        for(const mode of ["server", "client", "stop"]) expect(text).toMatch(new RegExp(`^  ${mode} `, "m"));
        expect(text).toContain("TTTGate client --help");
    });

    test("REQ-2 client help shows the common options in groups and nothing risky or hidden", () => {
        const text = renderHelp("client", false);
        const titles = ["Connection:", "Identity:", "TLS trust:", "Run:", "Tuning:"];
        const positions = titles.map(title => text.indexOf(title));
        expect(positions.every(p => p >= 0)).toBe(true);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        const tokens = optionTokens(text);
        for(const name of ["-addr", "-tls", "-clientId", "-clientSecret", "-clientSecretFile", "-name", "-ca", "-serverName",
            "-cert", "-privateKey", "-save", "-daemon", "-keepAlive", "-bufferLimit"]) {
            expect(tokens).toContain(name);
        }
        for(const name of ["-key", "-allowLegacyFallback", "-allowInsecureTls", "--yes-insecure", "-dev", "-displayName"]) {
            expect(tokens).not.toContain(name);
        }
    });

    test("REQ-2 server help keeps -requireCsrfHeader and the legacy switches out of the common list", () => {
        const text = renderHelp("server", false);
        for(const title of ["Admin:", "Proxy:", "Run:", "Tuning:"]) expect(text).toContain(title);
        const tokens = optionTokens(text);
        for(const name of ["-adminPort", "-trustXForwardedFor", "-trustedProxyHops", "-reset", "-daemon", "-keepAlive"]) {
            expect(tokens).toContain(name);
        }
        for(const name of ["-requireCsrfHeader", "-allowLegacyAdminHttp", "-allowLegacyAdminRemote", "-allowLegacyControlAuth"]) {
            expect(tokens).not.toContain(name);
        }
    });

    test("REQ-3 advanced help adds every risky option with its risk, and aliases next to their option", () => {
        const client = renderHelp("client", true);
        expect(client).toContain("Legacy and risky options:");
        expect(client).toMatch(/-allowInsecureTls[\s\S]*RISK: /);
        expect(client).toMatch(/-name .*\n.*alias: -displayName \(deprecated\)/);
        const server = renderHelp("server", true);
        expect(server).toMatch(/-requireCsrfHeader[\s\S]*RISK: /);
    });

    test("REQ-3 every visible primary option appears exactly once in some advanced help", () => {
        const texts = [renderHelp("server", true), renderHelp("client", true)].map(optionTokens);
        for(const def of CLI_OPTIONS) {
            if(def.hidden || def.aliasOf) continue;
            const token = def.name === "yes-insecure" ? "--yes-insecure" : def.name.length > 1 && def.group === "help" ? `--${def.name}` : `-${def.name}`;
            const counts = texts.map(tokens => tokens.filter(t => t === token).length);
            expect(counts.some(count => count === 1)).toBe(true);
            expect(counts.every(count => count <= 1)).toBe(true);
        }
    });

    test("REQ-4 the version is one line", () => {
        expect(renderVersion()).toMatch(/^TTTGate v\S+ \(\S+\)$/);
    });
});
